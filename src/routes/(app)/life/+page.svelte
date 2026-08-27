<script lang="ts">
  import { onMount } from 'svelte';
  import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    writeBatch
  } from 'firebase/firestore';
  import { db } from '$lib/firebase';
  import { user, userReady } from '$lib/stores/user';
  import { compressImageForFirestore, formatImageBytes, imageFileFromClipboard } from '$lib/utils/imageCompression';
  import {
    buildHouseholdTaskPrompt,
    normalizeHouseholdTaskName,
    parseHouseholdTaskCode,
    type HouseholdTaskDraft
  } from '$lib/utils/householdTaskExchange';
  import {
    STARTER_HABITS,
    activeEntries,
    addDays,
    bookProgress,
    compareDateKeys,
    dateFromKey,
    habitEntryForDate,
    isBookLinkedHabit,
    isHabitComplete,
    isHabitScheduledOn,
    localDateKey,
    recentDateKeys,
    safeNumber,
    scheduledHabitStats,
    taskDueState,
    type BookStatus,
    type DateKey,
    type HabitMode,
    type HabitScheduleKind,
    type LifeBook,
    type LifeEntry,
    type LifeHabit,
    type LifeTask
  } from '$lib/utils/lifeTracker';

  type LifeTab = 'today' | 'habits' | 'household' | 'books' | 'insights';
  type BookResult = {
    key?: string;
    title: string;
    author_name?: string[];
    cover_i?: number;
    isbn?: string[];
    number_of_pages_median?: number;
    first_publish_year?: number;
  };

  const tabs: Array<{ key: LifeTab; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'habits', label: 'Habits' },
    { key: 'household', label: 'Household' },
    { key: 'books', label: 'Books' },
    { key: 'insights', label: 'Insights' }
  ];
  const weekdays = [
    { value: 1, label: 'M' }, { value: 2, label: 'T' }, { value: 3, label: 'W' },
    { value: 4, label: 'T' }, { value: 5, label: 'F' }, { value: 6, label: 'S' },
    { value: 0, label: 'S' }
  ];
  const bookStatuses: Array<{ value: BookStatus; label: string }> = [
    { value: 'wishlist', label: 'Wishlist' }, { value: 'unread', label: 'Unread' },
    { value: 'reading', label: 'Reading' }, { value: 'paused', label: 'Paused' },
    { value: 'read', label: 'Read' }, { value: 'abandoned', label: 'Stopped' }
  ];

  let activeTab: LifeTab = 'today';
  let selectedDate: DateKey = localDateKey();
  let today: DateKey = localDateKey();
  let loading = true;
  let saving = false;
  let permissionError = false;
  let message = '';
  let habits: LifeHabit[] = [];
  let tasks: LifeTask[] = [];
  let books: LifeBook[] = [];
  let entries: LifeEntry[] = [];
  let loadedExactDates = new Set<string>();

  let habitName = '';
  let habitEmoji = '✓';
  let habitMode: HabitMode = 'boolean';
  let habitUnit = 'times';
  let habitScheduleKind: HabitScheduleKind = 'daily';
  let habitWeekdays: number[] = [1, 2, 3, 4, 5];
  let habitTimesPerWeek = 3;
  let habitLinkBook = false;
  let editingHabitId = '';
  let habitValues: Record<string, string> = {};
  let habitNotes: Record<string, string> = {};

  let taskName = '';
  let taskEmoji = '🧹';
  let taskIntervalDays = 7;
  let editingTaskId = '';
  let householdImportOpen = false;
  let householdImportCode = '';
  let householdImportErrors: string[] = [];
  let householdImportPreview: HouseholdTaskDraft[] = [];

  let bookTitle = '';
  let bookAuthor = '';
  let bookIsbn = '';
  let bookPages = '';
  let bookCoverUrl = '';
  let bookCoverImageBase64 = '';
  let bookImageMessage = '';
  let bookStatus: BookStatus = 'unread';
  let editingBookId = '';
  let bookSearchResults: BookResult[] = [];
  let searchingBooks = false;

  let readingBookId = '';
  let readingMinutes = '';
  let readingCurrentPage = '';
  let readingPages = '';
  let readingNote = '';
  let readingFinished = false;
  let quickReadingHabitId = '';

  $: activeHabits = habits.filter((habit) => !habit.archived);
  $: activeTasks = tasks.filter((task) => !task.archived);
  $: activeTaskNames = new Set(activeTasks.map((task) => normalizeHouseholdTaskName(task.name)));
  $: householdImportReady = householdImportPreview.filter((task) => !activeTaskNames.has(normalizeHouseholdTaskName(task.name)));
  $: householdImportDuplicates = householdImportPreview.filter((task) => activeTaskNames.has(normalizeHouseholdTaskName(task.name)));
  $: activeBooks = books.filter((book) => !book.archived);
  $: readingCandidates = activeBooks.filter((book) => !['read', 'abandoned'].includes(book.status));
  $: scheduledHabits = activeHabits.filter((habit) => isHabitScheduledOn(habit, selectedDate));
  $: completedScheduled = scheduledHabits.filter((habit) => isHabitComplete(entries, habit, selectedDate)).length;
  $: taskRows = activeTasks
    .map((task) => ({ task, state: dueState(task) }))
    .sort((a, b) => (a.state.daysUntilDue ?? -999) - (b.state.daysUntilDue ?? -999));
  $: dueTaskRows = taskRows.filter(({ state }) => ['new', 'due', 'overdue'].includes(state.tone));
  $: currentBooks = activeBooks.filter((book) => book.status === 'reading');
  $: readBooks = activeBooks.filter((book) => book.status === 'read');
  $: shelfBooks = activeBooks.filter((book) => book.status !== 'read');
  $: recentReading = activeEntries(entries)
    .filter((entry) => entry.kind === 'reading')
    .sort((a, b) => compareDateKeys(b.date, a.date))
    .slice(0, 12);
  $: recentActivity = activeEntries(entries)
    .sort((a, b) => compareDateKeys(b.date, a.date))
    .slice(0, 10);
  $: heatmapDates = recentDateKeys(84, today);
  $: totalReadingMinutes = activeEntries(entries)
    .filter((entry) => entry.kind === 'reading')
    .reduce((sum, entry) => sum + Number(entry.durationMinutes ?? 0), 0);

  function lifeCollection(uid: string, name: 'lifeHabits' | 'lifeTasks' | 'lifeBooks' | 'lifeEntries') {
    return collection(db, 'users', uid, name);
  }

  function flash(text: string) {
    message = text;
    window.setTimeout(() => {
      if (message === text) message = '';
    }, 3600);
  }

  async function loadLife(uid: string) {
    loading = true;
    permissionError = false;
    try {
      const recentStart = addDays(today, -83);
      const [habitSnap, taskSnap, bookSnap, entrySnap] = await Promise.all([
        getDocs(lifeCollection(uid, 'lifeHabits')),
        getDocs(lifeCollection(uid, 'lifeTasks')),
        getDocs(lifeCollection(uid, 'lifeBooks')),
        getDocs(query(lifeCollection(uid, 'lifeEntries'), where('date', '>=', recentStart)))
      ]);
      habits = habitSnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeHabit));
      tasks = taskSnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeTask));
      books = bookSnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeBook));
      entries = entrySnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeEntry));
      if (!readingBookId && books.length) readingBookId = books.find((book) => book.status === 'reading')?.id ?? books[0].id;
    } catch (error) {
      console.error('Could not load Life.', error);
      permissionError = true;
    } finally {
      loading = false;
    }
  }

  async function ensureDateLoaded(date: DateKey) {
    const uid = $user?.uid;
    if (!uid || compareDateKeys(date, addDays(today, -83)) >= 0 || loadedExactDates.has(date)) return;
    try {
      const snap = await getDocs(query(lifeCollection(uid, 'lifeEntries'), where('date', '==', date)));
      const incoming = snap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeEntry));
      const ids = new Set(entries.map((entry) => entry.id));
      entries = [...entries, ...incoming.filter((entry) => !ids.has(entry.id))];
      loadedExactDates = new Set([...loadedExactDates, date]);
    } catch (error) {
      console.warn('Could not load the selected historical date.', error);
    }
  }

  function selectDate(value: string) {
    selectedDate = value;
    ensureDateLoaded(selectedDate);
  }

  function taskSummaryEntries(task: LifeTask): LifeEntry[] {
    const actual = entries.filter((entry) => entry.kind === 'task' && entry.taskId === task.id);
    if (!task.lastCompletedDate || actual.some((entry) => entry.date === task.lastCompletedDate)) return actual;
    return [...actual, { id: `summary-${task.id}`, kind: 'task', taskId: task.id, date: task.lastCompletedDate }];
  }

  function dueState(task: LifeTask) {
    return taskDueState(task, taskSummaryEntries(task), today);
  }

  async function createStarterHabits() {
    const uid = $user?.uid;
    if (!uid || saving) return;
    saving = true;
    try {
      await Promise.all(STARTER_HABITS.map((habit) => addDoc(lifeCollection(uid, 'lifeHabits'), {
        ...habit,
        createdAt: serverTimestamp()
      })));
      await loadLife(uid);
      flash('Reading and piano practice are ready.');
    } catch (error) {
      console.error(error);
      flash('Could not create the starter habits.');
    } finally {
      saving = false;
    }
  }

  async function createHabit() {
    const uid = $user?.uid;
    if (!uid || !habitName.trim() || saving) return;
    saving = true;
    try {
      const wasEditing = Boolean(editingHabitId);
      const payload = {
        name: habitName.trim(), emoji: habitEmoji.trim() || '✓', mode: habitMode,
        unit: habitMode === 'count' ? habitUnit.trim() || 'times' : habitMode === 'duration' ? 'min' : '',
        scheduleKind: habitScheduleKind,
        weekdays: habitScheduleKind === 'weekdays' ? habitWeekdays : [],
        timesPerWeek: habitScheduleKind === 'weekly' ? Math.max(1, Number(habitTimesPerWeek) || 1) : null,
        linkedEntityType: habitLinkBook ? 'book' : null,
        archived: false
      };
      if (editingHabitId) {
        await updateDoc(doc(db, 'users', uid, 'lifeHabits', editingHabitId), { ...payload, updatedAt: serverTimestamp() });
        habits = habits.map((habit) => habit.id === editingHabitId ? { ...habit, ...payload } as LifeHabit : habit);
      } else {
        const ref = await addDoc(lifeCollection(uid, 'lifeHabits'), { ...payload, createdAt: serverTimestamp() });
        habits = [...habits, { id: ref.id, ...payload, createdAt: new Date() } as LifeHabit];
      }
      habitName = '';
      habitLinkBook = false;
      editingHabitId = '';
      flash(wasEditing ? 'Habit updated.' : 'Habit added.');
    } catch (error) {
      console.error(error);
      flash('The habit could not be saved.');
    } finally {
      saving = false;
    }
  }

  function editHabit(habit: LifeHabit) {
    editingHabitId = habit.id; habitName = habit.name; habitEmoji = habit.emoji; habitMode = habit.mode;
    habitUnit = habit.unit || 'times'; habitScheduleKind = habit.scheduleKind;
    habitWeekdays = [...(habit.weekdays ?? [1, 2, 3, 4, 5])]; habitTimesPerWeek = habit.timesPerWeek ?? 3;
    habitLinkBook = isBookLinkedHabit(habit);
  }

  function cancelHabitEdit() { editingHabitId = ''; habitName = ''; habitLinkBook = false; }

  async function saveHabitEntry(habit: LifeHabit) {
    const uid = $user?.uid;
    if (!uid || saving) return;
    const existing = habitEntryForDate(entries, habit.id, selectedDate);
    const deterministicId = `habit_${habit.id}_${selectedDate}`;
    const value = safeNumber(habitValues[habit.id], null);
    const payload: Omit<LifeEntry, 'id'> & { updatedAt: unknown; createdAt?: unknown } = {
      kind: 'habit', habitId: habit.id, date: selectedDate, completed: true, active: true,
      durationMinutes: habit.mode === 'duration' ? value : null,
      quantity: habit.mode === 'count' ? value : null,
      note: habitNotes[habit.id]?.trim() ?? '', updatedAt: serverTimestamp()
    };
    if (!existing) payload.createdAt = serverTimestamp();
    saving = true;
    try {
      await setDoc(doc(db, 'users', uid, 'lifeEntries', deterministicId), payload, { merge: true });
      entries = [
        ...entries.filter((entry) => entry.id !== deterministicId && !(entry.habitId === habit.id && entry.date === selectedDate)),
        { id: deterministicId, ...payload, updatedAt: new Date() }
      ];
      habitValues = { ...habitValues, [habit.id]: '' };
      habitNotes = { ...habitNotes, [habit.id]: '' };
      flash(`${habit.name} saved for ${formatDate(selectedDate)}.`);
    } catch (error) {
      console.error(error);
      flash('The entry could not be saved.');
    } finally {
      saving = false;
    }
  }

  async function toggleBooleanHabit(habit: LifeHabit) {
    const uid = $user?.uid;
    if (!uid || saving) return;
    const current = habitEntryForDate(entries, habit.id, selectedDate);
    const deterministicId = `habit_${habit.id}_${selectedDate}`;
    const active = !current;
    const payload: Omit<LifeEntry, 'id'> & { updatedAt: unknown; createdAt?: unknown } = {
      kind: 'habit', habitId: habit.id, date: selectedDate, completed: active, active,
      durationMinutes: null, quantity: null, note: current?.note ?? '', updatedAt: serverTimestamp(),
      ...(!entries.some((entry) => entry.id === deterministicId) ? { createdAt: serverTimestamp() } : {})
    };
    saving = true;
    try {
      await setDoc(doc(db, 'users', uid, 'lifeEntries', deterministicId), payload, { merge: true });
      entries = [...entries.filter((entry) => entry.id !== deterministicId && !(entry.habitId === habit.id && entry.date === selectedDate)), { id: deterministicId, ...payload }];
    } catch (error) {
      console.error(error);
      flash('The habit could not be updated.');
    } finally {
      saving = false;
    }
  }

  async function toggleHabitEntry(habit: LifeHabit) {
    const existing = habitEntryForDate(entries, habit.id, selectedDate);
    if (existing) return undoEntry(existing);
    if (isBookLinkedHabit(habit)) {
      quickReadingHabitId = habit.id;
      if (!readingBookId || !readingCandidates.some((book) => book.id === readingBookId)) {
        readingBookId = readingCandidates.find((book) => book.status === 'reading')?.id ?? readingCandidates[0]?.id ?? '';
      }
      return;
    }
    if (habit.mode === 'boolean') return toggleBooleanHabit(habit);
    return saveHabitEntry(habit);
  }

  async function archiveHabit(habit: LifeHabit) {
    const uid = $user?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'lifeHabits', habit.id), { archived: true, archivedAt: serverTimestamp() });
    habits = habits.map((item) => item.id === habit.id ? { ...item, archived: true } : item);
    flash('Habit archived. Its history was preserved.');
  }

  async function createTask() {
    const uid = $user?.uid;
    if (!uid || !taskName.trim() || saving) return;
    saving = true;
    try {
      const wasEditing = Boolean(editingTaskId);
      const payload = {
        name: taskName.trim(), emoji: taskEmoji.trim() || '🧹',
        intervalDays: Math.max(1, Number(taskIntervalDays) || 1), lastCompletedDate: null,
        archived: false
      };
      if (editingTaskId) {
        const existing = tasks.find((task) => task.id === editingTaskId);
        const patch = { ...payload, lastCompletedDate: existing?.lastCompletedDate ?? null, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, 'users', uid, 'lifeTasks', editingTaskId), patch);
        tasks = tasks.map((task) => task.id === editingTaskId ? { ...task, ...patch } as LifeTask : task);
      } else {
        const ref = await addDoc(lifeCollection(uid, 'lifeTasks'), { ...payload, createdAt: serverTimestamp() });
        tasks = [...tasks, { id: ref.id, ...payload, createdAt: new Date() } as LifeTask];
      }
      taskName = '';
      editingTaskId = '';
      flash(wasEditing ? 'Recurring task updated.' : 'Recurring task added.');
    } catch (error) {
      console.error(error);
      flash('The task could not be saved.');
    } finally {
      saving = false;
    }
  }

  function editTask(task: LifeTask) {
    editingTaskId = task.id; taskName = task.name; taskEmoji = task.emoji; taskIntervalDays = task.intervalDays;
  }

  function cancelTaskEdit() { editingTaskId = ''; taskName = ''; }

  async function copyHouseholdPlanningPrompt() {
    const prompt = buildHouseholdTaskPrompt(activeTasks);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = prompt;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    flash('ChatGPT household-planning prompt copied.');
  }

  function clearHouseholdImportPreview() {
    householdImportPreview = [];
    householdImportErrors = [];
  }

  function previewHouseholdImport() {
    const parsed = parseHouseholdTaskCode(householdImportCode);
    householdImportErrors = parsed.errors;
    householdImportPreview = parsed.tasks;
  }

  async function importHouseholdTasks() {
    const uid = $user?.uid;
    if (!uid || saving || !householdImportReady.length || householdImportErrors.length) return;
    saving = true;
    const batch = writeBatch(db);
    const incoming: LifeTask[] = [];
    try {
      for (const task of householdImportReady) {
        const reference = doc(lifeCollection(uid, 'lifeTasks'));
        const payload = {
          name: task.name,
          emoji: task.emoji || '🧹',
          intervalDays: task.intervalDays,
          lastCompletedDate: null,
          archived: false,
          createdAt: serverTimestamp()
        };
        batch.set(reference, payload);
        incoming.push({ id: reference.id, ...payload, createdAt: new Date() } as LifeTask);
      }
      await batch.commit();
      tasks = [...tasks, ...incoming];
      const importedCount = incoming.length;
      householdImportCode = '';
      householdImportPreview = [];
      householdImportErrors = [];
      householdImportOpen = false;
      flash(`${importedCount} household task${importedCount === 1 ? '' : 's'} imported safely.`);
    } catch (error) {
      console.error('Could not import household tasks.', error);
      flash('No household tasks were imported. Your existing tasks are unchanged.');
    } finally {
      saving = false;
    }
  }

  async function completeTask(task: LifeTask) {
    const uid = $user?.uid;
    if (!uid || saving) return;
    saving = true;
    try {
      const entryRef = doc(lifeCollection(uid, 'lifeEntries'));
      const taskRef = doc(db, 'users', uid, 'lifeTasks', task.id);
      const latest = !task.lastCompletedDate || compareDateKeys(selectedDate, task.lastCompletedDate) > 0
        ? selectedDate : task.lastCompletedDate;
      const batch = writeBatch(db);
      batch.set(entryRef, {
        kind: 'task', taskId: task.id, date: selectedDate, completed: true, active: true,
        previousLastCompletedDate: task.lastCompletedDate ?? null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      batch.update(taskRef, { lastCompletedDate: latest, updatedAt: serverTimestamp() });
      await batch.commit();
      entries = [...entries, { id: entryRef.id, kind: 'task', taskId: task.id, date: selectedDate, completed: true, active: true, previousLastCompletedDate: task.lastCompletedDate ?? null }];
      tasks = tasks.map((item) => item.id === task.id ? { ...item, lastCompletedDate: latest } : item);
      flash(`${task.name} completed on ${formatDate(selectedDate)}.`);
    } catch (error) {
      console.error(error);
      flash('The completion could not be saved.');
    } finally {
      saving = false;
    }
  }

  async function archiveTask(task: LifeTask) {
    const uid = $user?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'lifeTasks', task.id), { archived: true, archivedAt: serverTimestamp() });
    tasks = tasks.map((item) => item.id === task.id ? { ...item, archived: true } : item);
    flash('Task archived. Its completion history was preserved.');
  }

  async function searchBooks() {
    const term = [bookTitle, bookAuthor, bookIsbn].filter(Boolean).join(' ').trim();
    if (!term || searchingBooks) return;
    searchingBooks = true;
    bookSearchResults = [];
    try {
      const fields = 'key,title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year';
      const response = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(term)}&limit=6&fields=${fields}`);
      if (!response.ok) throw new Error('Book search failed.');
      const data = await response.json();
      bookSearchResults = Array.isArray(data.docs) ? data.docs : [];
      if (!bookSearchResults.length) flash('No matching books found. You can still add it manually.');
    } catch (error) {
      console.warn(error);
      flash('Book search is unavailable. Manual entry still works.');
    } finally {
      searchingBooks = false;
    }
  }

  function chooseBookResult(result: BookResult) {
    bookTitle = result.title ?? bookTitle;
    bookAuthor = result.author_name?.[0] ?? bookAuthor;
    bookIsbn = result.isbn?.[0] ?? bookIsbn;
    bookPages = result.number_of_pages_median ? String(result.number_of_pages_median) : bookPages;
    bookCoverUrl = result.cover_i ? `https://covers.openlibrary.org/b/id/${result.cover_i}-M.jpg` : bookCoverUrl;
    bookSearchResults = [];
    flash('Book details added. Review them before saving.');
  }

  async function processBookCover(file: File, source: 'upload' | 'paste') {
    bookImageMessage = source === 'paste' ? 'Compressing pasted cover…' : 'Compressing cover…';
    try {
      const result = await compressImageForFirestore(file);
      bookCoverImageBase64 = result.dataUrl;
      bookImageMessage = `Cover ready as ${result.storageFormat.toUpperCase()} · ${formatImageBytes(result.byteLength)}`;
    } catch (error) {
      console.error(error);
      bookImageMessage = error instanceof Error ? error.message : 'The cover could not be prepared.';
    }
  }

  async function handleBookCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) await processBookCover(file, 'upload');
  }

  async function handleBookCoverPaste(event: ClipboardEvent) {
    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) {
      bookImageMessage = 'The clipboard does not contain an image. Copy a cover and press ⌘V again.';
      return;
    }
    event.preventDefault();
    await processBookCover(file, 'paste');
  }

  async function createBook() {
    const uid = $user?.uid;
    if (!uid || !bookTitle.trim() || saving) return;
    saving = true;
    try {
      const payload = {
        title: bookTitle.trim(), author: bookAuthor.trim(), status: bookStatus,
        isbn: bookIsbn.trim(), totalPages: safeNumber(bookPages, null), currentPage: 0,
        coverUrl: bookCoverUrl.trim(), coverImageBase64: bookCoverImageBase64,
        startedDate: bookStatus === 'reading' ? selectedDate : null,
        finishedDate: bookStatus === 'read' ? selectedDate : null,
        rating: null, note: '', archived: false, createdAt: serverTimestamp()
      };
      if (editingBookId) {
        const existing = books.find((book) => book.id === editingBookId);
        const patch = {
          title: payload.title, author: payload.author, status: payload.status, isbn: payload.isbn,
          totalPages: payload.totalPages, coverUrl: payload.coverUrl,
          coverImageBase64: payload.coverImageBase64 || existing?.coverImageBase64 || '',
          startedDate: existing?.startedDate ?? (bookStatus === 'reading' ? selectedDate : null),
          finishedDate: bookStatus === 'read' ? existing?.finishedDate ?? selectedDate : existing?.finishedDate ?? null,
          updatedAt: serverTimestamp()
        };
        await updateDoc(doc(db, 'users', uid, 'lifeBooks', editingBookId), patch);
        books = books.map((book) => book.id === editingBookId ? { ...book, ...patch } as LifeBook : book);
      } else {
        const ref = await addDoc(lifeCollection(uid, 'lifeBooks'), payload);
        books = [...books, { id: ref.id, ...payload } as LifeBook];
        readingBookId ||= ref.id;
      }
      bookTitle = ''; bookAuthor = ''; bookIsbn = ''; bookPages = ''; bookCoverUrl = '';
      bookCoverImageBase64 = ''; bookImageMessage = ''; bookSearchResults = [];
      const wasEditing = Boolean(editingBookId);
      editingBookId = '';
      flash(wasEditing ? 'Book details updated.' : 'Book added to your shelf.');
    } catch (error) {
      console.error(error);
      flash('The book could not be saved.');
    } finally {
      saving = false;
    }
  }

  function editBook(book: LifeBook) {
    editingBookId = book.id; bookTitle = book.title; bookAuthor = book.author; bookIsbn = book.isbn ?? '';
    bookPages = book.totalPages ? String(book.totalPages) : ''; bookCoverUrl = book.coverUrl ?? '';
    bookCoverImageBase64 = book.coverImageBase64 ?? ''; bookStatus = book.status; bookImageMessage = '';
    activeTab = 'books';
  }

  function cancelBookEdit() {
    editingBookId = ''; bookTitle = ''; bookAuthor = ''; bookIsbn = ''; bookPages = '';
    bookCoverUrl = ''; bookCoverImageBase64 = ''; bookImageMessage = ''; bookSearchResults = [];
  }

  async function changeBookStatus(book: LifeBook, status: BookStatus) {
    const uid = $user?.uid;
    if (!uid) return;
    const patch: Record<string, any> = { status, updatedAt: serverTimestamp() };
    if (status === 'reading' && !book.startedDate) patch.startedDate = selectedDate;
    if (status === 'read') patch.finishedDate = selectedDate;
    await updateDoc(doc(db, 'users', uid, 'lifeBooks', book.id), patch);
    books = books.map((item) => item.id === book.id ? { ...item, ...patch, updatedAt: new Date() } : item);
    flash(`${book.title} moved to ${bookStatuses.find((item) => item.value === status)?.label}.`);
  }

  async function rateBook(book: LifeBook, rating: number) {
    const uid = $user?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'lifeBooks', book.id), { rating, updatedAt: serverTimestamp() });
    books = books.map((item) => item.id === book.id ? { ...item, rating } : item);
  }

  async function archiveBook(book: LifeBook) {
    const uid = $user?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'lifeBooks', book.id), { archived: true, archivedAt: serverTimestamp() });
    books = books.map((item) => item.id === book.id ? { ...item, archived: true } : item);
    flash('Book archived. Reading history was preserved.');
  }

  async function saveReadingSession(linkedHabitId = '') {
    const uid = $user?.uid;
    const book = books.find((item) => item.id === readingBookId);
    if (!uid || !book || saving) return;
    saving = true;
    try {
      const entryRef = doc(lifeCollection(uid, 'lifeEntries'));
      const currentPage = safeNumber(readingCurrentPage, null);
      const durationMinutes = safeNumber(readingMinutes, null);
      const quantity = safeNumber(readingPages, null);
      const nextPage = currentPage === null ? Number(book.currentPage ?? 0) : Math.max(Number(book.currentPage ?? 0), currentPage);
      const bookPatch: Record<string, any> = {
        status: readingFinished ? 'read' : book.status === 'wishlist' || book.status === 'unread' ? 'reading' : book.status,
        currentPage: nextPage,
        startedDate: book.startedDate ?? selectedDate,
        updatedAt: serverTimestamp()
      };
      if (readingFinished) bookPatch.finishedDate = selectedDate;
      const scheduledReadingHabit = activeHabits.find((habit) => isBookLinkedHabit(habit) && isHabitScheduledOn(habit, selectedDate));
      const habitId = linkedHabitId || scheduledReadingHabit?.id || '';
      const entryPayload = {
        kind: 'reading', bookId: book.id, date: selectedDate, completed: true, active: true,
        ...(habitId ? { habitId } : {}),
        durationMinutes, quantity, currentPage, note: readingNote.trim(),
        previousBookState: {
          status: book.status, currentPage: book.currentPage ?? 0,
          startedDate: book.startedDate ?? null, finishedDate: book.finishedDate ?? null
        },
        resultingBookState: {
          status: bookPatch.status, currentPage: nextPage,
          startedDate: bookPatch.startedDate ?? null,
          finishedDate: bookPatch.finishedDate ?? book.finishedDate ?? null
        },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      };
      const batch = writeBatch(db);
      batch.set(entryRef, entryPayload);
      batch.update(doc(db, 'users', uid, 'lifeBooks', book.id), bookPatch);
      await batch.commit();
      entries = [...entries, { id: entryRef.id, ...entryPayload } as LifeEntry];
      books = books.map((item) => item.id === book.id ? { ...item, ...bookPatch, updatedAt: new Date() } as LifeBook : item);
      readingMinutes = ''; readingCurrentPage = ''; readingPages = ''; readingNote = ''; readingFinished = false;
      quickReadingHabitId = '';
      flash(`Reading session saved${habitId ? ' and reading habit completed' : ''} for ${formatDate(selectedDate)}.`);
    } catch (error) {
      console.error(error);
      flash('The reading session could not be saved.');
    } finally {
      saving = false;
    }
  }

  function formatDate(key: DateKey | null | undefined) {
    if (!key) return '—';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(dateFromKey(key));
  }

  function scheduleLabel(habit: LifeHabit) {
    if (habit.scheduleKind === 'daily') return 'Every day';
    if (habit.scheduleKind === 'weekly') return `${habit.timesPerWeek ?? 1}× per week`;
    const labels = weekdays.filter((day) => habit.weekdays?.includes(day.value)).map((day) => day.label);
    return labels.join(' · ') || 'Selected days';
  }

  function bookCover(book: LifeBook) {
    return book.coverImageBase64 || book.coverUrl || '';
  }

  function bookForEntry(entry: LifeEntry) {
    return books.find((book) => book.id === entry.bookId);
  }

  function entryValue(entry: LifeEntry, habit: LifeHabit) {
    if (habit.mode === 'duration') return entry.durationMinutes ? `${entry.durationMinutes} min` : 'Done';
    if (habit.mode === 'count') return entry.quantity ? `${entry.quantity} ${habit.unit ?? ''}` : 'Done';
    return 'Done';
  }

  function activityTitle(entry: LifeEntry) {
    if (entry.kind === 'habit') return habits.find((habit) => habit.id === entry.habitId)?.name ?? 'Archived habit';
    if (entry.kind === 'task') return tasks.find((task) => task.id === entry.taskId)?.name ?? 'Archived task';
    return books.find((book) => book.id === entry.bookId)?.title ?? 'Archived book';
  }

  function activityMeta(entry: LifeEntry) {
    if (entry.kind === 'reading') {
      return [entry.durationMinutes ? `${entry.durationMinutes} min` : '', entry.quantity ? `${entry.quantity} pages` : ''].filter(Boolean).join(' · ') || 'Reading session';
    }
    if (entry.kind === 'task') return 'Recurring task completed';
    const habit = habits.find((item) => item.id === entry.habitId);
    return habit ? entryValue(entry, habit) : 'Habit completed';
  }

  async function undoEntry(entry: LifeEntry) {
    const uid = $user?.uid;
    if (!uid || saving) return;
    saving = true;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', uid, 'lifeEntries', entry.id), {
        active: false, completed: false, correctedAt: serverTimestamp(), updatedAt: serverTimestamp()
      });

      if (entry.kind === 'task' && entry.taskId) {
        const task = tasks.find((item) => item.id === entry.taskId);
        if (task?.lastCompletedDate === entry.date) {
          batch.update(doc(db, 'users', uid, 'lifeTasks', task.id), {
            lastCompletedDate: entry.previousLastCompletedDate ?? null,
            updatedAt: serverTimestamp()
          });
          tasks = tasks.map((item) => item.id === task.id ? { ...item, lastCompletedDate: entry.previousLastCompletedDate ?? null } : item);
        }
      }

      if (entry.kind === 'reading' && entry.bookId && entry.previousBookState) {
        const book = books.find((item) => item.id === entry.bookId);
        const hasLaterSession = activeEntries(entries).some((item) => item.id !== entry.id && item.kind === 'reading'
          && item.bookId === entry.bookId && compareDateKeys(item.date, entry.date) > 0);
        if (book && !hasLaterSession) {
          batch.update(doc(db, 'users', uid, 'lifeBooks', book.id), {
            ...entry.previousBookState, updatedAt: serverTimestamp()
          });
          books = books.map((item) => item.id === book.id ? { ...item, ...entry.previousBookState } : item);
        }
      }

      await batch.commit();
      entries = entries.map((item) => item.id === entry.id ? { ...item, active: false, completed: false } : item);
      flash('Entry undone without deleting its history. You can now log the corrected date.');
    } catch (error) {
      console.error(error);
      flash('The entry could not be undone.');
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (tabs.some((tab) => tab.key === requestedTab)) activeTab = requestedTab as LifeTab;
    const unsubscribe = userReady.subscribe((ready) => {
      if (!ready) return;
      const uid = $user?.uid;
      if (uid) loadLife(uid);
      else loading = false;
    });
    return unsubscribe;
  });
</script>

<svelte:head><title>Life · Trackr</title><meta name="description" content="Habits, recurring tasks, books and reading sessions in Trackr." /></svelte:head>

<main class="life-page">
  <section class="hero">
    <div class="orb violet"></div><div class="orb green"></div>
    <div class="hero-copy">
      <p class="eyebrow">Trackr Life</p>
      <h1>Small things,<br />kept in motion.</h1>
      <p>Habits without guilt, household rhythms without surprises, and a living shelf of every book you finish.</p>
    </div>
    <div class="date-card">
      <span>Recording for</span>
      <input type="date" value={selectedDate} max={today} on:change={(event) => selectDate((event.currentTarget as HTMLInputElement).value)} aria-label="Activity date" />
      <small>{selectedDate === today ? 'Today' : `Backfilling ${formatDate(selectedDate)}`}</small>
    </div>
  </section>

  <nav class="life-tabs" aria-label="Life sections">
    {#each tabs as tab}
      <button class:active={activeTab === tab.key} on:click={() => (activeTab = tab.key)}>{tab.label}</button>
    {/each}
  </nav>

  <div class="mobile-lite-banner"><strong>Life Lite</strong><span>Log today, check things off, keep moving.</span></div>

  {#if message}<div class="toast" role="status" aria-live="polite">✓ {message}</div>{/if}

  {#if loading}
    <div class="state-card">Loading Life…</div>
  {:else if permissionError}
    <section class="state-card error-state">
      <strong>Life is built, but Firestore has not permitted its new private collections yet.</strong>
      <p>Publish the updated rules included with Trackr. Existing data has not been changed.</p>
    </section>
  {:else if activeTab === 'today'}
    <section class="today-summary">
      <article class="summary-card purple"><span>Habits</span><strong>{completedScheduled}/{scheduledHabits.length}</strong><small>for {formatDate(selectedDate)}</small></article>
      <article class="summary-card coral"><span>Due</span><strong>{dueTaskRows.length}</strong><small>recurring tasks</small></article>
      <article class="summary-card mint"><span>Reading</span><strong>{currentBooks.length}</strong><small>currently reading</small></article>
    </section>

    {#if !activeHabits.length && !activeTasks.length && !activeBooks.length}
      <section class="starter-card">
        <div><p class="eyebrow">A gentle beginning</p><h2>Start with reading and piano.</h2><p>You can edit or archive either later. No data is created until you choose this starter set.</p></div>
        <button class="primary" on:click={createStarterHabits} disabled={saving}>Create starter habits</button>
      </section>
    {/if}

    <section class="today-grid">
      <div class="panel">
        <div class="section-head"><div><p class="eyebrow">Habits</p><h2>For this day</h2></div><button class="text-button mobile-admin-control" on:click={() => (activeTab = 'habits')}>Manage</button></div>
        <div class="check-list">
          {#each scheduledHabits as habit (habit.id)}
            {@const entry = habitEntryForDate(entries, habit.id, selectedDate)}
            <article class:done={Boolean(entry)} class="habit-check">
              <button class="check-button" on:click={() => toggleHabitEntry(habit)} aria-label={`${entry ? 'Undo' : 'Complete'} ${habit.name}`}>{entry ? '✓' : habit.emoji}</button>
              <div class="check-copy"><strong>{habit.name}</strong><span>{entry ? entryValue(entry, habit) : scheduleLabel(habit)}</span></div>
              {#if habit.mode !== 'boolean'}
                <input class="quick-value" type="number" min="0" placeholder={habit.mode === 'duration' ? 'min' : habit.unit ?? 'count'} bind:value={habitValues[habit.id]} aria-label={`${habit.name} value`} />
              {/if}
            </article>
            {#if quickReadingHabitId === habit.id && !entry}
              <div class="quick-reading">
                {#if readingCandidates.length}
                  <label><span>Active book</span><select bind:value={readingBookId}>{#each readingCandidates as book}<option value={book.id}>{book.title} — {book.author}</option>{/each}</select></label>
                  <label><span>Read until page</span><input type="number" min="0" bind:value={readingCurrentPage} placeholder="e.g. 128" /></label>
                  <label><span>Minutes</span><input type="number" min="0" bind:value={readingMinutes} placeholder="optional" /></label>
                  <label class="quick-note"><span>Note</span><input bind:value={readingNote} placeholder="optional" /></label>
                  <div class="quick-actions"><button class="secondary" on:click={() => (quickReadingHabitId = '')}>Cancel</button><button class="primary" on:click={() => saveReadingSession(habit.id)} disabled={saving || !readingBookId}>Save reading</button></div>
                {:else}
                  <p>No active book yet. Add a book or move one to “Reading” first.</p>
                  <div class="quick-actions"><button class="secondary" on:click={() => (quickReadingHabitId = '')}>Cancel</button><button class="primary" on:click={() => (activeTab = 'books')}>Open books</button></div>
                {/if}
              </div>
            {/if}
          {:else}<p class="empty">No habits scheduled for this day.</p>{/each}
        </div>
      </div>

      <div class="panel">
        <div class="section-head"><div><p class="eyebrow">Household</p><h2>Needs attention</h2></div><button class="text-button" on:click={() => (activeTab = 'household')}>All tasks</button></div>
        <div class="check-list">
          {#each dueTaskRows.slice(0, 5) as row (row.task.id)}
            <article class="task-check {row.state.tone}">
              <button class="check-button" on:click={() => completeTask(row.task)} aria-label={`Complete ${row.task.name}`}>{row.task.emoji}</button>
              <div class="check-copy"><strong>{row.task.name}</strong><span>{row.state.label}</span></div>
              <small>Every {row.task.intervalDays}d</small>
            </article>
          {:else}<p class="empty">Nothing is due. Nicely under control.</p>{/each}
        </div>
      </div>
    </section>

    {#if currentBooks.length}
      <section class="panel continue-reading">
        <div class="section-head"><div><p class="eyebrow">Continue reading</p><h2>Your open books</h2></div><button class="text-button" on:click={() => (activeTab = 'books')}>Open shelf</button></div>
        <div class="book-strip">
          {#each currentBooks as book (book.id)}
            <button class="mini-book" on:click={() => { readingBookId = book.id; activeTab = 'books'; }}>
              <div class="cover">{#if bookCover(book)}<img src={bookCover(book)} alt={`Cover of ${book.title}`} />{:else}<span>{book.title.slice(0, 1)}</span>{/if}</div>
              <div><strong>{book.title}</strong><span>{book.author || 'Unknown author'}</span><div class="progress"><i style={`width:${bookProgress(book)}%`}></i></div><small>{bookProgress(book)}%</small></div>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if recentActivity.length}
      <section class="panel activity-panel">
        <div class="section-head"><div><p class="eyebrow">Recent activity</p><h2>Correct anything without deleting history.</h2></div></div>
        <div class="activity-list">
          {#each recentActivity as entry (entry.id)}
            <article>
              <span>{entry.kind === 'habit' ? '✓' : entry.kind === 'task' ? '↻' : '📖'}</span>
              <div><strong>{activityTitle(entry)}</strong><small>{formatDate(entry.date)} · {activityMeta(entry)}</small></div>
              <button class="archive" on:click={() => undoEntry(entry)}>Undo</button>
            </article>
          {/each}
        </div>
      </section>
    {/if}

  {:else if activeTab === 'habits'}
    <section class="two-column">
      <div class="panel form-panel">
        <p class="eyebrow">New habit</p><h2>What should happen more often?</h2>
        <div class="form-grid compact">
          <label class="emoji-field"><span>Icon</span><input bind:value={habitEmoji} maxlength="4" /></label>
          <label class="wide"><span>Name</span><input bind:value={habitName} placeholder="Read, practice piano…" /></label>
          <label><span>Track</span><select bind:value={habitMode}><option value="boolean">Yes / no</option><option value="duration">Duration</option><option value="count">Quantity</option></select></label>
          {#if habitMode === 'count'}<label><span>Unit</span><input bind:value={habitUnit} placeholder="pages, glasses…" /></label>{/if}
          <label><span>Schedule</span><select bind:value={habitScheduleKind}><option value="daily">Every day</option><option value="weekdays">Selected days</option><option value="weekly">Times per week</option></select></label>
          {#if habitScheduleKind === 'weekly'}<label><span>Times</span><input type="number" min="1" max="14" bind:value={habitTimesPerWeek} /></label>{/if}
          <label class="wide link-check"><input type="checkbox" bind:checked={habitLinkBook} /><span>Link this habit to a book and reading progress</span></label>
        </div>
        {#if habitScheduleKind === 'weekdays'}
          <div class="weekday-row">{#each weekdays as day}<label><input type="checkbox" value={day.value} bind:group={habitWeekdays} /><span>{day.label}</span></label>{/each}</div>
        {/if}
        <div class="button-row">{#if editingHabitId}<button class="secondary" on:click={cancelHabitEdit}>Cancel</button>{/if}<button class="primary" class:full={!editingHabitId} on:click={createHabit} disabled={!habitName.trim() || saving}>{editingHabitId ? 'Save habit changes' : 'Add habit'}</button></div>
      </div>

      <div class="panel">
        <div class="section-head"><div><p class="eyebrow">Your habits</p><h2>{activeHabits.length} active</h2></div></div>
        {#each activeHabits as habit (habit.id)}
          {@const entry = habitEntryForDate(entries, habit.id, selectedDate)}
          {@const stats = scheduledHabitStats(habit, entries, today)}
          <article class="manage-row">
            <span class="entity-icon">{habit.emoji}</span>
            <div><strong>{habit.name}</strong><span>{scheduleLabel(habit)} · {stats.rate}% over 12 weeks</span></div>
            <button class:complete={Boolean(entry)} class="pill-button" on:click={() => toggleHabitEntry(habit)}>{entry ? 'Undo' : 'Log'}</button>
            <button class="archive" on:click={() => editHabit(habit)}>Edit</button>
            <button class="archive" on:click={() => archiveHabit(habit)} aria-label={`Archive ${habit.name}`}>Archive</button>
          </article>
          {#if habit.mode !== 'boolean'}
            <div class="log-extras">
              <input type="number" min="0" bind:value={habitValues[habit.id]} placeholder={habit.mode === 'duration' ? 'Minutes' : habit.unit ?? 'Quantity'} />
              <input bind:value={habitNotes[habit.id]} placeholder="Optional note" />
            </div>
          {/if}
        {:else}<p class="empty">No habits yet. The starter set adds reading and piano practice.</p><button class="secondary" on:click={createStarterHabits}>Create starter set</button>{/each}
      </div>
    </section>

  {:else if activeTab === 'household'}
    <section class="panel household-import">
      <div class="household-import-head">
        <div><p class="eyebrow">ChatGPT planner</p><h2>Build your maintenance rhythm.</h2><p>Let ChatGPT propose household tasks and realistic intervals, then preview everything before Trackr creates anything.</p></div>
        <div class="household-import-actions"><button class="secondary" on:click={copyHouseholdPlanningPrompt}>Copy planning prompt</button><button class="primary" on:click={() => (householdImportOpen = !householdImportOpen)}>{householdImportOpen ? 'Close importer' : 'Import task plan'}</button></div>
      </div>
      {#if householdImportOpen}
        <div class="household-import-body">
          <label><span>Paste TRACKR_HOUSEHOLD_TASKS_V1 code</span><textarea bind:value={householdImportCode} on:input={clearHouseholdImportPreview} placeholder={'TRACKR_HOUSEHOLD_TASKS_V1\n{\n  "format": "trackr-household-tasks",\n  "version": 1,\n  "tasks": [ ... ]\n}'}></textarea></label>
          <button class="secondary preview-button" on:click={previewHouseholdImport} disabled={!householdImportCode.trim()}>Preview plan</button>
          {#if householdImportErrors.length}<ul class="import-errors" aria-live="polite">{#each householdImportErrors as error}<li>{error}</li>{/each}</ul>{/if}
          {#if householdImportPreview.length}
            <div class="import-preview">
              <div class="section-head"><div><p class="eyebrow">Import preview</p><h2>{householdImportReady.length} new task{householdImportReady.length === 1 ? '' : 's'}</h2></div>{#if householdImportDuplicates.length}<span class="duplicate-count">{householdImportDuplicates.length} already exist</span>{/if}</div>
              <div class="import-task-grid">{#each householdImportPreview as task}<article class:duplicate={activeTaskNames.has(normalizeHouseholdTaskName(task.name))}><span>{task.emoji}</span><div><strong>{task.name}</strong><small>Every {task.intervalDays} day{task.intervalDays === 1 ? '' : 's'}</small></div><i>{activeTaskNames.has(normalizeHouseholdTaskName(task.name)) ? 'Already exists' : 'New'}</i></article>{/each}</div>
              <p class="form-note">Existing tasks are skipped. New tasks are created together, so a failed import cannot leave a partial list.</p>
              <button class="primary full" on:click={importHouseholdTasks} disabled={saving || !householdImportReady.length}>{saving ? 'Importing…' : `Import ${householdImportReady.length} new task${householdImportReady.length === 1 ? '' : 's'}`}</button>
            </div>
          {/if}
        </div>
      {/if}
    </section>
    <section class="two-column">
      <div class="panel form-panel">
        <p class="eyebrow">Recurring task</p><h2>Keep maintenance predictable.</h2>
        <div class="form-grid compact">
          <label class="emoji-field"><span>Icon</span><input bind:value={taskEmoji} maxlength="4" /></label>
          <label class="wide"><span>Task</span><input bind:value={taskName} placeholder="Change bed linen" /></label>
          <label class="wide"><span>Repeat every</span><div class="input-suffix"><input type="number" min="1" bind:value={taskIntervalDays} /><span>days</span></div></label>
        </div>
        <p class="form-note">Completing it for a past date correctly recalculates its next due date.</p>
        <div class="button-row">{#if editingTaskId}<button class="secondary" on:click={cancelTaskEdit}>Cancel</button>{/if}<button class="primary" class:full={!editingTaskId} on:click={createTask} disabled={!taskName.trim() || saving}>{editingTaskId ? 'Save task changes' : 'Add recurring task'}</button></div>
      </div>
      <div class="panel">
        <div class="section-head"><div><p class="eyebrow">Schedule</p><h2>What comes next</h2></div><span class="count">{activeTasks.length}</span></div>
        <div class="task-list">
          {#each taskRows as row (row.task.id)}
            <article class="due-row {row.state.tone}">
              <span class="entity-icon">{row.task.emoji}</span>
              <div><strong>{row.task.name}</strong><span>{row.state.label} · every {row.task.intervalDays} days</span>{#if row.state.lastDone}<small>Last done {formatDate(row.state.lastDone)}</small>{/if}</div>
              <button class="pill-button" on:click={() => completeTask(row.task)}>Done on {selectedDate === today ? 'today' : formatDate(selectedDate)}</button>
              <button class="archive" on:click={() => editTask(row.task)}>Edit</button>
              <button class="archive" on:click={() => archiveTask(row.task)}>Archive</button>
            </article>
          {:else}<p class="empty">No recurring tasks yet.</p>{/each}
        </div>
      </div>
    </section>

  {:else if activeTab === 'books'}
    <section class="book-layout">
      <div class="panel book-form">
        <p class="eyebrow">Add a book</p><h2>Grow your Trackr shelf.</h2>
        <div class="cover-form-preview">{#if bookCoverImageBase64 || bookCoverUrl}<img src={bookCoverImageBase64 || bookCoverUrl} alt="Book cover preview" />{:else}<span>Cover</span>{/if}</div>
        <div class="form-grid">
          <label class="wide"><span>Title</span><input bind:value={bookTitle} placeholder="Book title" /></label>
          <label class="wide"><span>Author</span><input bind:value={bookAuthor} placeholder="Author" /></label>
          <label><span>ISBN</span><input bind:value={bookIsbn} placeholder="Optional" /></label>
          <label><span>Pages</span><input type="number" min="1" bind:value={bookPages} placeholder="Optional" /></label>
          <label class="wide"><span>Status</span><select bind:value={bookStatus}>{#each bookStatuses as status}<option value={status.value}>{status.label}</option>{/each}</select></label>
          <label class="wide"><span>Cover URL</span><input bind:value={bookCoverUrl} placeholder="https://…" /></label>
          <div class="cover-inputs upload"><label><span>Upload a cover</span><input type="file" accept="image/*" on:change={handleBookCover} /></label><div class="cover-paste-zone" role="textbox" aria-multiline="false" tabindex="0" on:paste={handleBookCoverPaste} aria-label="Paste a book cover from the clipboard"><strong>Or click here and press ⌘V</strong><span>Paste a copied book cover.</span></div><small>{bookImageMessage || 'Compressed to a small Firestore-safe image.'}</small></div>
        </div>
        <div class="button-row">{#if editingBookId}<button class="secondary" on:click={cancelBookEdit}>Cancel</button>{/if}<button class="secondary" on:click={searchBooks} disabled={searchingBooks || ![bookTitle, bookAuthor, bookIsbn].some(Boolean)}>{searchingBooks ? 'Searching…' : 'Find book details'}</button><button class="primary" on:click={createBook} disabled={!bookTitle.trim() || saving}>{editingBookId ? 'Save book changes' : 'Add to shelf'}</button></div>
        {#if bookSearchResults.length}
          <div class="search-results">{#each bookSearchResults as result}<button on:click={() => chooseBookResult(result)}>{#if result.cover_i}<img src={`https://covers.openlibrary.org/b/id/${result.cover_i}-S.jpg`} alt="" />{:else}<i>?</i>{/if}<span><strong>{result.title}</strong><small>{result.author_name?.[0] ?? 'Unknown author'}{result.first_publish_year ? ` · ${result.first_publish_year}` : ''}</small></span></button>{/each}</div>
        {/if}
      </div>

      <div class="panel reading-form">
        <p class="eyebrow">Reading session</p><h2>Log what you read.</h2>
        {#if activeBooks.length}
          <label><span>Book</span><select bind:value={readingBookId}>{#each activeBooks as book}<option value={book.id}>{book.title} — {book.author}</option>{/each}</select></label>
          <div class="form-grid">
            <label><span>Minutes</span><input type="number" min="0" bind:value={readingMinutes} placeholder="25" /></label>
            <label><span>Pages read</span><input type="number" min="0" bind:value={readingPages} placeholder="12" /></label>
            <label class="wide"><span>Current page</span><input type="number" min="0" bind:value={readingCurrentPage} placeholder="Where are you now?" /></label>
            <label class="wide"><span>Note</span><textarea bind:value={readingNote} placeholder="Optional thought or chapter"></textarea></label>
          </div>
          <label class="finish-check"><input type="checkbox" bind:checked={readingFinished} /><span>Finished this book on {formatDate(selectedDate)}</span></label>
          <button class="primary full" on:click={() => saveReadingSession()} disabled={saving}>Save session for {selectedDate === today ? 'today' : formatDate(selectedDate)}</button>
        {:else}<p class="empty">Add a book before logging a reading session.</p>{/if}
      </div>
    </section>

    <section class="panel shelf-panel">
      <div class="section-head"><div><p class="eyebrow">Your shelf</p><h2>{activeBooks.length} books · {readBooks.length} read</h2></div></div>
      <h3>Reading & saved</h3>
      <div class="shelf-grid">
        {#each shelfBooks as book (book.id)}
          <article class="book-card">
            <div class="book-cover">{#if bookCover(book)}<img src={bookCover(book)} alt={`Cover of ${book.title}`} />{:else}<span>{book.title.slice(0, 1)}</span>{/if}</div>
            <div class="book-copy"><strong>{book.title}</strong><span>{book.author || 'Unknown author'}</span><div class="progress"><i style={`width:${bookProgress(book)}%`}></i></div><small>{bookProgress(book)}% · {book.currentPage ?? 0}{book.totalPages ? ` / ${book.totalPages} pages` : ''}</small></div>
            <select value={book.status} on:change={(event) => changeBookStatus(book, (event.currentTarget as HTMLSelectElement).value as BookStatus)} aria-label={`Status for ${book.title}`}>{#each bookStatuses as status}<option value={status.value}>{status.label}</option>{/each}</select>
            <div class="book-actions"><button class="archive" on:click={() => editBook(book)}>Edit</button><button class="archive" on:click={() => archiveBook(book)}>Archive</button></div>
          </article>
        {:else}<p class="empty">No books waiting on your shelf.</p>{/each}
      </div>
      {#if readBooks.length}<h3 class="read-heading">Read</h3><div class="shelf-grid read-shelf">{#each readBooks as book (book.id)}<article class="book-card"><div class="book-cover">{#if bookCover(book)}<img src={bookCover(book)} alt={`Cover of ${book.title}`} />{:else}<span>{book.title.slice(0, 1)}</span>{/if}</div><div class="book-copy"><strong>{book.title}</strong><span>{book.author || 'Unknown author'}</span><small>Finished {formatDate(book.finishedDate)}</small><div class="rating" aria-label={`Rating for ${book.title}`}>{#each [1,2,3,4,5] as star}<button class:active={Number(book.rating ?? 0) >= star} on:click={() => rateBook(book, star)} aria-label={`${star} stars`}>★</button>{/each}</div></div><select value={book.status} on:change={(event) => changeBookStatus(book, (event.currentTarget as HTMLSelectElement).value as BookStatus)}>{#each bookStatuses as status}<option value={status.value}>{status.label}</option>{/each}</select><div class="book-actions"><button class="archive" on:click={() => editBook(book)}>Edit</button><button class="archive" on:click={() => archiveBook(book)}>Archive</button></div></article>{/each}</div>{/if}
    </section>

    {#if recentReading.length}<section class="panel reading-history"><div class="section-head"><div><p class="eyebrow">Reading history</p><h2>Recent sessions</h2></div><strong>{totalReadingMinutes} min</strong></div>{#each recentReading as entry}<article><span>{formatDate(entry.date)}</span><div><strong>{bookForEntry(entry)?.title ?? 'Archived book'}</strong><small>{entry.durationMinutes ? `${entry.durationMinutes} min` : ''}{entry.quantity ? ` · ${entry.quantity} pages` : ''}{entry.currentPage ? ` · page ${entry.currentPage}` : ''}</small></div><p>{entry.note}</p></article>{/each}</section>{/if}

  {:else if activeTab === 'insights'}
    <section class="insight-hero"><div><p class="eyebrow">12 weeks</p><h2>Patterns, not pressure.</h2><p>Missing a day does not erase anything. This view simply shows what is becoming part of your life.</p></div><div><strong>{readBooks.length}</strong><span>books read</span></div><div><strong>{totalReadingMinutes}</strong><span>reading minutes</span></div></section>
    <section class="panel heatmap-panel">
      <div class="section-head"><div><p class="eyebrow">Habit rhythm</p><h2>The last 84 days</h2></div></div>
      {#each activeHabits as habit (habit.id)}
        {@const stats = scheduledHabitStats(habit, entries, today)}
        <article class="heatmap-row">
          <div class="heatmap-label"><span>{habit.emoji}</span><div><strong>{habit.name}</strong><small>{stats.completed} of {stats.scheduled} scheduled · {stats.rate}%</small></div></div>
          <div class="heatmap">{#each heatmapDates as date}<i class:scheduled={isHabitScheduledOn(habit, date)} class:filled={Boolean(habitEntryForDate(entries, habit.id, date))} title={`${formatDate(date)}: ${habitEntryForDate(entries, habit.id, date) ? 'done' : 'not logged'}`}></i>{/each}</div>
        </article>
      {:else}<p class="empty">Add a habit to begin seeing patterns.</p>{/each}
    </section>
    <section class="panel task-insights"><div class="section-head"><div><p class="eyebrow">Maintenance</p><h2>Recurring task health</h2></div></div><div class="status-grid"><article><strong>{taskRows.filter((row) => row.state.tone === 'overdue').length}</strong><span>overdue</span></article><article><strong>{taskRows.filter((row) => row.state.tone === 'due' || row.state.tone === 'soon').length}</strong><span>due soon</span></article><article><strong>{taskRows.filter((row) => row.state.tone === 'ok').length}</strong><span>under control</span></article></div></section>
  {/if}
</main>

<style>
  :global(body){background:#f5f5f2}.life-page{max-width:1320px;margin:0 auto;padding:0 0 5rem;color:#171717;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif}.hero{position:relative;min-height:300px;padding:2.4rem 3rem;display:flex;align-items:center;justify-content:space-between;gap:2rem;overflow:hidden;border-radius:30px;background:linear-gradient(120deg,#f0edff,#fff 50%,#eaf8f1);box-shadow:0 24px 65px rgba(36,29,74,.08)}.orb{position:absolute;border-radius:50%;filter:blur(10px);opacity:.5}.orb.violet{width:280px;height:280px;left:-80px;top:-110px;background:#d9d0ff}.orb.green{width:250px;height:250px;right:-50px;bottom:-140px;background:#cdebdc}.hero-copy,.date-card{position:relative;z-index:1}.eyebrow{margin:0 0 .4rem;color:#777;font-size:.66rem;font-weight:850;letter-spacing:.11em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(2.7rem,6vw,5.3rem);line-height:.88;letter-spacing:-.07em}.hero-copy>p:last-child{max-width:590px;margin:1.15rem 0 0;color:#626262;line-height:1.55}.date-card{min-width:220px;padding:1rem;border:1px solid rgba(255,255,255,.9);border-radius:20px;background:rgba(255,255,255,.72);box-shadow:0 14px 38px rgba(0,0,0,.06);backdrop-filter:blur(16px)}.date-card span,.date-card small{display:block;color:#777;font-size:.65rem}.date-card input{width:100%;box-sizing:border-box;margin:.4rem 0;padding:.6rem;border:1px solid #e3e3df;border-radius:10px;background:#fff;font:inherit;font-weight:750}.life-tabs{position:sticky;top:calc(56px + env(safe-area-inset-top));z-index:8;margin:1rem 0;padding:.35rem;display:flex;gap:.3rem;overflow-x:auto;border:1px solid #e7e7e3;border-radius:999px;background:rgba(255,255,255,.9);backdrop-filter:blur(15px)}.life-tabs button{flex:1;min-width:95px;padding:.62rem;border:0;border-radius:999px;background:transparent;color:#777;font:inherit;font-size:.72rem;font-weight:750;cursor:pointer}.life-tabs button.active{background:#171717;color:#fff}.toast{position:fixed;right:1.2rem;bottom:calc(5.5rem + env(safe-area-inset-bottom));z-index:50;max-width:360px;padding:.75rem 1rem;border-radius:999px;background:#171717;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,.18);font-size:.72rem;font-weight:750}.state-card,.panel,.starter-card{border:1px solid #e8e8e4;border-radius:24px;background:#fff;box-shadow:0 14px 42px rgba(0,0,0,.045)}.state-card{padding:4rem;text-align:center;color:#777}.error-state strong{color:#9b3e3e}.error-state p{margin:.5rem 0 0}.today-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem}.summary-card{padding:1.15rem 1.25rem;border-radius:22px}.summary-card span,.summary-card small{display:block;color:#6d6d6d;font-size:.66rem}.summary-card strong{display:block;margin:.18rem 0;font-size:2rem;letter-spacing:-.05em}.summary-card.purple{background:#eeeaff}.summary-card.coral{background:#fff0e7}.summary-card.mint{background:#e9f7f0}.starter-card{margin-top:.8rem;padding:1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;background:linear-gradient(120deg,#fff,#f4f1ff)}.starter-card h2,.section-head h2,.form-panel h2,.book-form h2,.reading-form h2{margin:0;font-size:1.2rem;letter-spacing:-.03em}.starter-card p:not(.eyebrow){margin:.35rem 0 0;color:#777;font-size:.75rem}.today-grid,.two-column,.book-layout{margin-top:.8rem;display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.panel{padding:1.15rem}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.section-head>span.count{min-width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#f0f0ed;color:#777;font-size:.7rem}.text-button,.archive{padding:.2rem;border:0;background:transparent;color:#777;font:inherit;font-size:.65rem;cursor:pointer}.check-list,.task-list{margin-top:.8rem;display:grid;gap:.45rem}.habit-check,.task-check,.manage-row,.due-row{padding:.65rem;display:flex;align-items:center;gap:.65rem;border:1px solid #ecece8;border-radius:15px;background:#fafaf8}.habit-check.done{background:#f1faf5;border-color:#d9ecdf}.check-button,.entity-icon{width:40px;height:40px;flex-shrink:0;display:grid;place-items:center;border:0;border-radius:12px;background:#efefec;color:#222;font-size:1.1rem;cursor:pointer}.done .check-button{background:#266849;color:#fff}.check-copy,.manage-row>div,.due-row>div{min-width:0;flex:1}.check-copy strong,.check-copy span,.manage-row strong,.manage-row span,.due-row strong,.due-row span,.due-row small{display:block}.check-copy strong,.manage-row strong,.due-row strong{font-size:.76rem}.check-copy span,.manage-row span,.due-row span,.due-row small{margin-top:.12rem;color:#808080;font-size:.62rem}.quick-value{width:65px;padding:.42rem;border:1px solid #ddd;border-radius:9px}.task-check.overdue,.due-row.overdue{border-color:#f0c8c4;background:#fff4f1}.task-check.due,.due-row.due{border-color:#efd9af;background:#fff9ed}.task-check>small{color:#888;font-size:.58rem}.empty{margin:1rem 0;color:#999;font-size:.72rem}.continue-reading{margin-top:.8rem}.book-strip{margin-top:.8rem;display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}.mini-book{padding:.55rem;display:grid;grid-template-columns:48px 1fr;gap:.55rem;border:1px solid #ecece8;border-radius:14px;background:#fafaf8;color:inherit;text-align:left;cursor:pointer}.cover,.book-cover,.cover-form-preview{overflow:hidden;display:grid;place-items:center;background:linear-gradient(145deg,#ddd5ff,#d5eadf);color:#fff;font-weight:850}.cover{width:48px;height:66px;border-radius:7px}.cover img,.book-cover img,.cover-form-preview img{width:100%;height:100%;object-fit:cover}.mini-book strong,.mini-book span,.mini-book small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mini-book strong{font-size:.68rem}.mini-book span,.mini-book small{color:#888;font-size:.57rem}.progress{height:4px;margin:.35rem 0;border-radius:999px;background:#e5e5e1;overflow:hidden}.progress i{display:block;height:100%;border-radius:inherit;background:#735be2}.form-grid{margin:.9rem 0;display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.form-grid.compact{grid-template-columns:90px 1fr}.form-grid label,.book-form label,.reading-form label{display:block}.form-grid label.wide{grid-column:1/-1}.form-grid label>span,.book-form label>span,.reading-form label>span{display:block;margin-bottom:.25rem;color:#777;font-size:.59rem;font-weight:800;text-transform:uppercase}.form-grid input,.form-grid select,.form-grid textarea,.book-form>label select,.reading-form>label select{width:100%;box-sizing:border-box;padding:.62rem .68rem;border:1px solid #deded9;border-radius:10px;background:#fff;font:inherit;font-size:.72rem}.form-grid textarea{min-height:76px;resize:vertical}.emoji-field input{text-align:center;font-size:1.1rem}.weekday-row{margin:.2rem 0 .8rem;display:flex;gap:.35rem}.weekday-row label input{position:absolute;opacity:0}.weekday-row span{width:32px;height:32px;display:grid;place-items:center;border:1px solid #ddd;border-radius:50%;color:#777;font-size:.65rem;cursor:pointer}.weekday-row input:checked+span{background:#171717;color:#fff;border-color:#171717}.primary,.secondary,.pill-button{padding:.65rem .85rem;border:1px solid #171717;border-radius:999px;background:#171717;color:#fff;font:inherit;font-size:.68rem;font-weight:800;cursor:pointer}.secondary{background:#fff;color:#171717;border-color:#ddd}.full{width:100%}button:disabled{opacity:.45;cursor:not-allowed}.manage-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;margin-top:.45rem}.pill-button{padding:.46rem .65rem}.pill-button.complete{background:#27684a;border-color:#27684a}.archive{font-size:.58rem}.log-extras{margin:-.15rem 0 .6rem 3.3rem;display:grid;grid-template-columns:100px 1fr;gap:.4rem}.log-extras input{padding:.5rem;border:1px solid #ddd;border-radius:9px}.input-suffix{display:flex;align-items:center;border:1px solid #deded9;border-radius:10px;background:#fff}.input-suffix input{border:0}.input-suffix span{padding-right:.7rem;color:#888;font-size:.65rem}.form-note{color:#888;font-size:.66rem;line-height:1.5}.due-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto}.book-layout{grid-template-columns:1.2fr .8fr}.book-form,.reading-form{position:relative}.cover-form-preview{position:absolute;right:1.15rem;top:1.15rem;width:58px;height:82px;border-radius:8px;font-size:.6rem}.book-form>h2{padding-right:75px}.upload small{display:block;margin-top:.3rem;color:#777;font-size:.58rem;text-transform:none}.button-row{display:flex;justify-content:flex-end;gap:.45rem}.search-results{margin-top:.7rem;padding-top:.7rem;display:grid;grid-template-columns:1fr 1fr;gap:.4rem;border-top:1px solid #eee}.search-results button{padding:.4rem;display:grid;grid-template-columns:34px 1fr;gap:.4rem;align-items:center;border:1px solid #e6e6e2;border-radius:10px;background:#fafaf8;color:inherit;text-align:left;cursor:pointer}.search-results img,.search-results i{width:34px;height:46px;object-fit:cover;border-radius:4px;background:#eee}.search-results span,.search-results strong,.search-results small{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.search-results strong{font-size:.62rem}.search-results small{color:#888;font-size:.55rem}.finish-check{margin:.4rem 0 .8rem;display:flex!important;gap:.45rem;align-items:center}.finish-check span{margin:0!important;text-transform:none!important}.shelf-panel,.reading-history,.heatmap-panel,.task-insights{margin-top:.8rem}.shelf-panel h3{margin:1rem 0 .55rem;font-size:.75rem}.shelf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}.book-card{padding:.6rem;display:grid;grid-template-columns:64px minmax(0,1fr);gap:.55rem;border:1px solid #ecece8;border-radius:15px;background:#fafaf8}.book-cover{width:64px;height:92px;border-radius:7px;grid-row:1/4}.book-copy{min-width:0}.book-copy strong,.book-copy span,.book-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.book-copy strong{font-size:.72rem}.book-copy span,.book-copy small{color:#888;font-size:.59rem}.book-card select{min-width:0;padding:.35rem;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:.58rem}.book-card .archive{justify-self:start}.read-heading{padding-top:.8rem;border-top:1px solid #eee}.read-shelf .book-card{background:#f3faf6}.rating{display:flex;margin-top:.25rem}.rating button{padding:0;border:0;background:transparent;color:#d1d1cc;cursor:pointer}.rating button.active{color:#e0a323}.reading-history article{padding:.6rem 0;display:grid;grid-template-columns:90px 1fr 1fr;gap:.7rem;border-top:1px solid #eee;align-items:center}.reading-history article>span,.reading-history small{color:#888;font-size:.62rem}.reading-history article strong{display:block;font-size:.7rem}.reading-history article p{margin:0;color:#777;font-size:.62rem}.insight-hero{padding:1.4rem;display:grid;grid-template-columns:1fr auto auto;gap:2rem;align-items:end;border-radius:24px;background:linear-gradient(120deg,#ece8ff,#fff,#e7f6ef)}.insight-hero h2{margin:0;font-size:2rem;letter-spacing:-.05em}.insight-hero p:not(.eyebrow){max-width:600px;color:#777;font-size:.75rem}.insight-hero>div:not(:first-child) strong,.insight-hero>div:not(:first-child) span{display:block}.insight-hero>div:not(:first-child) strong{font-size:2rem}.insight-hero>div:not(:first-child) span{color:#777;font-size:.62rem}.heatmap-row{padding:.8rem 0;display:grid;grid-template-columns:190px 1fr;gap:1rem;align-items:center;border-top:1px solid #eee}.heatmap-label{display:flex;align-items:center;gap:.55rem}.heatmap-label>span{font-size:1.2rem}.heatmap-label strong,.heatmap-label small{display:block}.heatmap-label strong{font-size:.7rem}.heatmap-label small{color:#888;font-size:.58rem}.heatmap{display:grid;grid-template-columns:repeat(28,1fr);gap:3px}.heatmap i{aspect-ratio:1;border-radius:3px;background:#efefeb}.heatmap i.scheduled{background:#e4e1ef}.heatmap i.filled{background:#735be2}.status-grid{margin-top:.8rem;display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}.status-grid article{padding:1rem;border-radius:16px;background:#f6f6f3}.status-grid strong,.status-grid span{display:block}.status-grid strong{font-size:1.8rem}.status-grid span{color:#888;font-size:.62rem}.status-grid article:first-child strong{color:#b54b42}
  .cover-inputs{grid-column:1/-1;display:grid;gap:.35rem}.cover-inputs small{color:#777;font-size:.58rem}.cover-paste-zone{padding:.55rem .65rem;border:1px dashed #cfcfc9;border-radius:9px;background:#fafaf8;outline:none;cursor:text}.cover-paste-zone:focus{border-color:#755cff;box-shadow:0 0 0 3px rgba(117,92,255,.1)}.cover-paste-zone strong,.cover-paste-zone>span{display:block}.cover-paste-zone strong{font-size:.67rem}.cover-paste-zone>span{margin-top:.1rem;color:#888;font-size:.59rem}.quick-reading{margin:-.1rem 0 .35rem;padding:.7rem;display:grid;grid-template-columns:1.5fr .8fr .7fr;gap:.45rem;border:1px solid #dcd5ff;border-radius:14px;background:#f5f2ff}.quick-reading label>span{display:block;margin-bottom:.22rem;color:#6f62a7;font-size:.55rem;font-weight:800;text-transform:uppercase}.quick-reading input,.quick-reading select{width:100%;box-sizing:border-box;padding:.5rem;border:1px solid #ddd7f4;border-radius:9px;background:#fff;font:inherit;font-size:.65rem}.quick-reading .quick-note{grid-column:1/-1}.quick-reading p{grid-column:1/-1;margin:0;color:#716b83;font-size:.68rem}.quick-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:.35rem}.link-check{padding:.6rem;display:flex!important;align-items:center;gap:.5rem;border:1px solid #e4e0f6;border-radius:11px;background:#f7f5ff}.link-check input{width:auto!important}.link-check span{margin:0!important;color:#665997!important;text-transform:none!important}.manage-row,.due-row{grid-template-columns:40px minmax(0,1fr) auto auto auto}.book-actions{display:flex;gap:.45rem}.activity-panel{margin-top:.8rem}.activity-list{margin-top:.7rem;display:grid;grid-template-columns:1fr 1fr;gap:.4rem}.activity-list article{padding:.55rem .65rem;display:grid;grid-template-columns:28px 1fr auto;gap:.5rem;align-items:center;border:1px solid #ecece8;border-radius:12px;background:#fafaf8}.activity-list article>span{font-size:.8rem}.activity-list strong,.activity-list small{display:block}.activity-list strong{font-size:.68rem}.activity-list small{margin-top:.1rem;color:#888;font-size:.57rem}
  .household-import{margin-top:.8rem;background:linear-gradient(120deg,#f1eeff,#fff 58%,#edf8f2)}.household-import-head{display:flex;align-items:center;justify-content:space-between;gap:1rem}.household-import-head h2{margin:0;font-size:1.2rem;letter-spacing:-.03em}.household-import-head>div>p:not(.eyebrow){max-width:690px;margin:.35rem 0 0;color:#777;font-size:.72rem;line-height:1.5}.household-import-actions{display:flex;gap:.4rem;flex-shrink:0}.household-import-body{margin-top:1rem;padding-top:1rem;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.6rem;align-items:end;border-top:1px solid rgba(0,0,0,.08)}.household-import-body>label>span{display:block;margin-bottom:.3rem;color:#6d648a;font-size:.58rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.household-import-body textarea{width:100%;min-height:145px;padding:.75rem;box-sizing:border-box;resize:vertical;border:1px solid #dad5ec;border-radius:12px;background:#fff;font:500 .66rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.preview-button{min-height:42px}.import-errors{grid-column:1/-1;margin:0;padding:.7rem 1rem .7rem 1.8rem;border-radius:12px;background:#fff0f1;color:#9c3340;font-size:.68rem}.import-preview{grid-column:1/-1;padding:.85rem;border:1px solid #ded9ef;border-radius:16px;background:rgba(255,255,255,.76)}.duplicate-count{padding:.3rem .55rem;border-radius:999px;background:#f0f0ed;color:#777;font-size:.58rem}.import-task-grid{margin:.7rem 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem}.import-task-grid article{padding:.58rem;display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:.5rem;align-items:center;border:1px solid #dfeadf;border-radius:12px;background:#f6fbf8}.import-task-grid article.duplicate{border-color:#e6e6e2;background:#f5f5f2;opacity:.65}.import-task-grid article>span{font-size:1rem}.import-task-grid strong,.import-task-grid small{display:block}.import-task-grid strong{font-size:.66rem}.import-task-grid small{margin-top:.12rem;color:#777;font-size:.57rem}.import-task-grid i{color:#39704e;font-size:.52rem;font-style:normal;font-weight:850;text-transform:uppercase}.import-task-grid .duplicate i{color:#777}
  @media(max-width:980px){.today-grid,.two-column,.book-layout{grid-template-columns:1fr}.book-strip,.shelf-grid{grid-template-columns:repeat(2,1fr)}.import-task-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.heatmap{grid-template-columns:repeat(21,1fr)}}
  @media(max-width:680px){.life-page{padding-bottom:4rem}.hero{padding:1.5rem;align-items:flex-start;flex-direction:column}.hero h1{font-size:3.2rem}.date-card{width:100%;box-sizing:border-box}.today-summary{grid-template-columns:1fr 1fr}.today-summary .summary-card:last-child{grid-column:1/-1}.starter-card,.household-import-head{align-items:stretch;flex-direction:column}.household-import-actions{display:grid;grid-template-columns:1fr}.household-import-body{grid-template-columns:1fr}.preview-button{width:100%}.import-task-grid{grid-template-columns:1fr}.book-strip,.shelf-grid,.activity-list{grid-template-columns:1fr}.quick-reading{grid-template-columns:1fr 1fr}.quick-reading label:first-child,.quick-reading .quick-note{grid-column:1/-1}.manage-row,.due-row{grid-template-columns:40px 1fr auto}.manage-row .archive,.due-row .archive{grid-column:2}.search-results{grid-template-columns:1fr}.reading-history article{grid-template-columns:75px 1fr}.reading-history article p{grid-column:2}.insight-hero{grid-template-columns:1fr 1fr}.insight-hero>div:first-child{grid-column:1/-1}.heatmap-row{grid-template-columns:1fr}.heatmap{grid-template-columns:repeat(14,1fr)}.status-grid{grid-template-columns:1fr 1fr}.form-grid.compact{grid-template-columns:74px 1fr}}
  .mobile-lite-banner{display:none}
  @media(max-width:680px){
    .hero{min-height:0;padding:1rem 1.05rem;gap:.8rem;border-radius:22px}
    .hero-copy>p:last-child,.orb{display:none}
    .hero h1{font-size:2.35rem;line-height:.92}
    .date-card{min-width:0;padding:.65rem .75rem;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:.2rem .65rem;border-radius:15px}
    .date-card input{grid-column:2;grid-row:1/3;margin:0;padding:.5rem}
    .life-tabs{top:calc(56px + env(safe-area-inset-top));margin:.65rem 0;padding:.25rem}
    .life-tabs button{min-width:78px;min-height:40px;padding:.45rem .55rem}
    .mobile-lite-banner{display:flex;align-items:center;gap:.55rem;margin:0 0 .65rem;padding:.55rem .7rem;border-radius:13px;background:#eeeaff;color:#5f50a2;font-size:.62rem}
    .mobile-lite-banner strong{padding:.2rem .4rem;border-radius:999px;background:#735be2;color:#fff;font-size:.56rem;text-transform:uppercase;letter-spacing:.08em}
    .today-summary{grid-template-columns:repeat(3,1fr);gap:.4rem}
    .today-summary .summary-card:last-child{grid-column:auto}
    .summary-card{padding:.7rem;border-radius:16px}
    .summary-card strong{font-size:1.45rem}
    .today-grid,.two-column,.book-layout{margin-top:.55rem;gap:.55rem}
    .panel{padding:.8rem;border-radius:18px;box-shadow:none}
    .form-panel,.household-import,.book-form,.starter-card,.mobile-admin-control,.manage-row .archive,.due-row .archive,.book-actions,.book-card>select{display:none!important}
    .manage-row,.due-row{grid-template-columns:40px minmax(0,1fr) auto}
    .habit-check,.task-check,.manage-row,.due-row{min-height:54px;box-sizing:border-box}
    .check-button,.entity-icon{width:44px;height:44px}
    .pill-button{min-height:40px}
    .book-layout{display:block}
    .reading-form{margin-top:0}
    .book-card{grid-template-columns:54px minmax(0,1fr)}
    .book-cover{width:54px;height:78px}
    .activity-panel{margin-top:.55rem}
  }
</style>
