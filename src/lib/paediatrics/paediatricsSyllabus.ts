export type PaediatricsBlockId = 'A' | 'B' | 'C';
export type PaediatricsTopicDefinition = { id: string; block: PaediatricsBlockId; number: number; title: string; titleIsPlaceholder: boolean };
// The exam date is deliberately unset until supplied or saved in the study plan.
export const PAEDIATRICS_EXAM_DATE = '';
export const PAEDIATRICS_BLOCKS: ReadonlyArray<{id: PaediatricsBlockId; count: number; label: string}> = [
  {id:'A',count:40,label:'Questions A'}, {id:'B',count:40,label:'Questions B'}, {id:'C',count:40,label:'Questions C'}
];
// Official source: Paediatrics State Exam Questions.pdf, pages 1–5. Each subquestion counts separately.
export const PAEDIATRICS_SYLLABUS: readonly PaediatricsTopicDefinition[] = [
  {
    "id": "1a",
    "block": "A",
    "number": 1,
    "title": "History-taking In Paediatrics",
    "titleIsPlaceholder": false
  },
  {
    "id": "1b",
    "block": "B",
    "number": 1,
    "title": "Epilepsy in children, Febrile Seizures",
    "titleIsPlaceholder": false
  },
  {
    "id": "1c",
    "block": "C",
    "number": 1,
    "title": "Vomiting, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "2a",
    "block": "A",
    "number": 2,
    "title": "Physical Exam in Paediatrics, specifics for individual age groups.",
    "titleIsPlaceholder": false
  },
  {
    "id": "2b",
    "block": "B",
    "number": 2,
    "title": "Tuberculosis in Children",
    "titleIsPlaceholder": false
  },
  {
    "id": "2c",
    "block": "C",
    "number": 2,
    "title": "Hypoglycemia, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "3a",
    "block": "A",
    "number": 3,
    "title": "Premature newborn: classification of age periods, specific characteristics, Mortality and diseases",
    "titleIsPlaceholder": false
  },
  {
    "id": "3b",
    "block": "B",
    "number": 3,
    "title": "Diabetes Mellitus type 1.",
    "titleIsPlaceholder": false
  },
  {
    "id": "3c",
    "block": "C",
    "number": 3,
    "title": "Joint Swelling, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "4a",
    "block": "A",
    "number": 4,
    "title": "Physiological newborn: physical findings of a mature newborn, characteristics of the neonatal period, common diseases",
    "titleIsPlaceholder": false
  },
  {
    "id": "4b",
    "block": "B",
    "number": 4,
    "title": "Cystic Fibrosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "4c",
    "block": "C",
    "number": 4,
    "title": "Disorders of Calcium-phosphate metabolism, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "5a",
    "block": "A",
    "number": 5,
    "title": "Preschooler and young-schooler: main characteristics of the period, growth and development, common diseases",
    "titleIsPlaceholder": false
  },
  {
    "id": "5b",
    "block": "B",
    "number": 5,
    "title": "Intrauterine Infections",
    "titleIsPlaceholder": false
  },
  {
    "id": "5c",
    "block": "C",
    "number": 5,
    "title": "Polyuria, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "6a",
    "block": "A",
    "number": 6,
    "title": "Infant and toddler: main milestones of the period, growth and development, common diseases",
    "titleIsPlaceholder": false
  },
  {
    "id": "6b",
    "block": "B",
    "number": 6,
    "title": "Disorders of adrenal glands function",
    "titleIsPlaceholder": false
  },
  {
    "id": "6c",
    "block": "C",
    "number": 6,
    "title": "Gastrointestinal bleeding, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "7a",
    "block": "A",
    "number": 7,
    "title": "Adolescent: main characteristics of the period, growth and development, common diseases, HEADSS",
    "titleIsPlaceholder": false
  },
  {
    "id": "7b",
    "block": "B",
    "number": 7,
    "title": "Liver Diseases in Paediatrics",
    "titleIsPlaceholder": false
  },
  {
    "id": "7c",
    "block": "C",
    "number": 7,
    "title": "Hypertension, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "8a",
    "block": "A",
    "number": 8,
    "title": "Assessment of growth and development, growth charts analysis",
    "titleIsPlaceholder": false
  },
  {
    "id": "8b",
    "block": "B",
    "number": 8,
    "title": "Congenital heart disease and malformations",
    "titleIsPlaceholder": false
  },
  {
    "id": "8c",
    "block": "C",
    "number": 8,
    "title": "Diarrhea, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "9a",
    "block": "A",
    "number": 9,
    "title": "Breastfeeding (composition of breast milk, comparison with artificial milk formula, importance, contraindications)",
    "titleIsPlaceholder": false
  },
  {
    "id": "9b",
    "block": "B",
    "number": 9,
    "title": "Disorders of sexual differentiation",
    "titleIsPlaceholder": false
  },
  {
    "id": "9c",
    "block": "C",
    "number": 9,
    "title": "Abdominal pain, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "10a",
    "block": "A",
    "number": 10,
    "title": "Nutrition of the child in infancy and toddler age, risks of alternative diets",
    "titleIsPlaceholder": false
  },
  {
    "id": "10b",
    "block": "B",
    "number": 10,
    "title": "Cardiomyopathy and heart arrhythmias in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "10c",
    "block": "C",
    "number": 10,
    "title": "Neuroinfections, Differential Diagnosis and treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "11a",
    "block": "A",
    "number": 11,
    "title": "Artificial milk formulas, types of formulas and their use in clinical practice",
    "titleIsPlaceholder": false
  },
  {
    "id": "11b",
    "block": "B",
    "number": 11,
    "title": "Disorders of adenohypophysis",
    "titleIsPlaceholder": false
  },
  {
    "id": "11c",
    "block": "C",
    "number": 11,
    "title": "Fever, hyperpyrexia, body temperature: definitions, therapy",
    "titleIsPlaceholder": false
  },
  {
    "id": "12a",
    "block": "A",
    "number": 12,
    "title": "Basic and advanced cardiopulmonary resuscitation of newborn and child",
    "titleIsPlaceholder": false
  },
  {
    "id": "12b",
    "block": "B",
    "number": 12,
    "title": "Congenital malformations of respiratory tract",
    "titleIsPlaceholder": false
  },
  {
    "id": "12c",
    "block": "C",
    "number": 12,
    "title": "Failure to thrive (FTT) in infancy and toddler age, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "13a",
    "block": "A",
    "number": 13,
    "title": "Acute expiratory dyspnea – clinical manifestation, Differential Diagnosis, therapeutic approach",
    "titleIsPlaceholder": false
  },
  {
    "id": "13b",
    "block": "B",
    "number": 13,
    "title": "Inflammatory bowel diseases",
    "titleIsPlaceholder": false
  },
  {
    "id": "13c",
    "block": "C",
    "number": 13,
    "title": "Hematuria in children, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "14a",
    "block": "A",
    "number": 14,
    "title": "Acute inspiratory dyspnea – clinical manifestation, Differential Diagnosis, therapeutic approach",
    "titleIsPlaceholder": false
  },
  {
    "id": "14b",
    "block": "B",
    "number": 14,
    "title": "Diseases of the gallbladder, bile ducts, and pancreas in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "14c",
    "block": "C",
    "number": 14,
    "title": "Neuromuscular diseases, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "15a",
    "block": "A",
    "number": 15,
    "title": "Foreign body in airways and gastrointestinal tract",
    "titleIsPlaceholder": false
  },
  {
    "id": "15b",
    "block": "B",
    "number": 15,
    "title": "Nephrotic syndrome",
    "titleIsPlaceholder": false
  },
  {
    "id": "15c",
    "block": "C",
    "number": 15,
    "title": "Developmental delay, Differential Diagnosis and treatment.",
    "titleIsPlaceholder": false
  },
  {
    "id": "16a",
    "block": "A",
    "number": 16,
    "title": "Allergic reaction, anaphylactic shock",
    "titleIsPlaceholder": false
  },
  {
    "id": "16b",
    "block": "B",
    "number": 16,
    "title": "Congenital malformation of gastrointestinal tract",
    "titleIsPlaceholder": false
  },
  {
    "id": "16c",
    "block": "C",
    "number": 16,
    "title": "Hypotonia of newborn and infant, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "17a",
    "block": "A",
    "number": 17,
    "title": "The most common intoxications in childhood and their therapy",
    "titleIsPlaceholder": false
  },
  {
    "id": "17b",
    "block": "B",
    "number": 17,
    "title": "Pneumonia in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "17c",
    "block": "C",
    "number": 17,
    "title": "Proteinuria in children, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "18a",
    "block": "A",
    "number": 18,
    "title": "Burn injury",
    "titleIsPlaceholder": false
  },
  {
    "id": "18b",
    "block": "B",
    "number": 18,
    "title": "Acute glomerulonephritis, nephritic syndrome",
    "titleIsPlaceholder": false
  },
  {
    "id": "18c",
    "block": "C",
    "number": 18,
    "title": "Musculoskeletal pain, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "19a",
    "block": "A",
    "number": 19,
    "title": "Acute abdomen in paediatrics, signs and symptoms, Differential Diagnosis, therapy",
    "titleIsPlaceholder": false
  },
  {
    "id": "19b",
    "block": "B",
    "number": 19,
    "title": "Peri-, myocarditis and endocarditis in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "19c",
    "block": "C",
    "number": 19,
    "title": "Common childhood exanthems, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "20a",
    "block": "A",
    "number": 20,
    "title": "Oral and parenteral rehydration, realimentation",
    "titleIsPlaceholder": false
  },
  {
    "id": "20b",
    "block": "B",
    "number": 20,
    "title": "Asthma bronchiale",
    "titleIsPlaceholder": false
  },
  {
    "id": "20c",
    "block": "C",
    "number": 20,
    "title": "Hyperbilirubinemia, Differential Diagnosis, treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "21a",
    "block": "A",
    "number": 21,
    "title": "Specific Features of Pediatric Pharmacotherapy",
    "titleIsPlaceholder": false
  },
  {
    "id": "21b",
    "block": "B",
    "number": 21,
    "title": "Acute and Chronic Renal Failure",
    "titleIsPlaceholder": false
  },
  {
    "id": "21c",
    "block": "C",
    "number": 21,
    "title": "Thyroid Gland Disorders, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "22a",
    "block": "A",
    "number": 22,
    "title": "Immunisations: Principles and its importance, Vaccination schedule, Obligatory and voluntary Immunisations, Adverse effects",
    "titleIsPlaceholder": false
  },
  {
    "id": "22b",
    "block": "B",
    "number": 22,
    "title": "Urinary Tract Infections in Children",
    "titleIsPlaceholder": false
  },
  {
    "id": "22c",
    "block": "C",
    "number": 22,
    "title": "Premature and Delayed Puberty, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "23a",
    "block": "A",
    "number": 23,
    "title": "Neonatal Screening – clinical and laboratory",
    "titleIsPlaceholder": false
  },
  {
    "id": "23b",
    "block": "B",
    "number": 23,
    "title": "Primary Systemic Vasculitis",
    "titleIsPlaceholder": false
  },
  {
    "id": "23c",
    "block": "C",
    "number": 23,
    "title": "Malabsorption Syndromes in Children, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "24a",
    "block": "A",
    "number": 24,
    "title": "Preventive examination in Primary Pediatric Care, Screening in Paediatrics",
    "titleIsPlaceholder": false
  },
  {
    "id": "24b",
    "block": "B",
    "number": 24,
    "title": "Upper Respiratory Tract Infections, Clinical Manifestations and Treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "24c",
    "block": "C",
    "number": 24,
    "title": "Heart Murmurs, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "25a",
    "block": "A",
    "number": 25,
    "title": "Early Neonatal Care, Postnatal Adaptation and First Examination by Paediatrician after birth.",
    "titleIsPlaceholder": false
  },
  {
    "id": "25b",
    "block": "B",
    "number": 25,
    "title": "Systemic Autoimmune Disorders",
    "titleIsPlaceholder": false
  },
  {
    "id": "25c",
    "block": "C",
    "number": 25,
    "title": "Headache, Meningeal signs, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "26a",
    "block": "A",
    "number": 26,
    "title": "Life-threatening Congenital Malformations in a newborn",
    "titleIsPlaceholder": false
  },
  {
    "id": "26b",
    "block": "B",
    "number": 26,
    "title": "Gastroesophageal Reflux, Infant Colic",
    "titleIsPlaceholder": false
  },
  {
    "id": "26c",
    "block": "C",
    "number": 26,
    "title": "Lymphadenopathy, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "27a",
    "block": "A",
    "number": 27,
    "title": "Birth traumas",
    "titleIsPlaceholder": false
  },
  {
    "id": "27b",
    "block": "B",
    "number": 27,
    "title": "Leukemia and Lymphoma in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "27c",
    "block": "C",
    "number": 27,
    "title": "Growth Disorders, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "28a",
    "block": "A",
    "number": 28,
    "title": "Genetic testing in Paediatrics, Chromosomal aberrations, Types of inheritance and associated diseases.",
    "titleIsPlaceholder": false
  },
  {
    "id": "28b",
    "block": "B",
    "number": 28,
    "title": "Syndrome of risky behavior in adolescence, Drug-abuse, Possibilities of intervention",
    "titleIsPlaceholder": false
  },
  {
    "id": "28c",
    "block": "C",
    "number": 28,
    "title": "Hepatopathy and Hepatomegaly, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "29a",
    "block": "A",
    "number": 29,
    "title": "Specific Features of Biochemistry and Hematology Tests in Children",
    "titleIsPlaceholder": false
  },
  {
    "id": "29b",
    "block": "B",
    "number": 29,
    "title": "Reactive arthritis, Rheumatic fever, Juvenile idiopathic arthritis",
    "titleIsPlaceholder": false
  },
  {
    "id": "29c",
    "block": "C",
    "number": 29,
    "title": "Splenomegaly, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "30a",
    "block": "A",
    "number": 30,
    "title": "Blood-gas and Acid-Base status analyses, interpretation",
    "titleIsPlaceholder": false
  },
  {
    "id": "30b",
    "block": "B",
    "number": 30,
    "title": "Micturition Disorders and Enuresis, Dysuria, Anuria, Oliguria",
    "titleIsPlaceholder": false
  },
  {
    "id": "30c",
    "block": "C",
    "number": 30,
    "title": "Anaemia, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "31a",
    "block": "A",
    "number": 31,
    "title": "Pneumopathies in newborns, RDS",
    "titleIsPlaceholder": false
  },
  {
    "id": "31b",
    "block": "B",
    "number": 31,
    "title": "Parasitic infections",
    "titleIsPlaceholder": false
  },
  {
    "id": "31c",
    "block": "C",
    "number": 31,
    "title": "Collapse, Syncope in children, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "32a",
    "block": "A",
    "number": 32,
    "title": "Apnoea, Acute life-threatening conditions in infancy (ALTE/BRUE, SIDS), Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "32b",
    "block": "B",
    "number": 32,
    "title": "Congenital and Acquired Coagulopathies in Children",
    "titleIsPlaceholder": false
  },
  {
    "id": "32c",
    "block": "C",
    "number": 32,
    "title": "Immunodeficiencies, Differential Diagnosis.",
    "titleIsPlaceholder": false
  },
  {
    "id": "33a",
    "block": "A",
    "number": 33,
    "title": "Shock (classification, causes, treatment) (classification, causes, treatment)",
    "titleIsPlaceholder": false
  },
  {
    "id": "33b",
    "block": "B",
    "number": 33,
    "title": "Congenital Malformations of the Urinary Tract",
    "titleIsPlaceholder": false
  },
  {
    "id": "33c",
    "block": "C",
    "number": 33,
    "title": "Stooling, Constipation disorders, Anal prolapse, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "34a",
    "block": "A",
    "number": 34,
    "title": "Child abuse and neglect syndrome (CAN)",
    "titleIsPlaceholder": false
  },
  {
    "id": "34b",
    "block": "B",
    "number": 34,
    "title": "Disorders of Lipid Metabolism",
    "titleIsPlaceholder": false
  },
  {
    "id": "34c",
    "block": "C",
    "number": 34,
    "title": "Oedema, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "35a",
    "block": "A",
    "number": 35,
    "title": "ADHD, specific learning disabilities, autism",
    "titleIsPlaceholder": false
  },
  {
    "id": "35b",
    "block": "B",
    "number": 35,
    "title": "Disorders of Carbohydrate Metabolism",
    "titleIsPlaceholder": false
  },
  {
    "id": "35c",
    "block": "C",
    "number": 35,
    "title": "Disorders of Consciousness, Convulsions, Differential, First aid",
    "titleIsPlaceholder": false
  },
  {
    "id": "36a",
    "block": "A",
    "number": 36,
    "title": "Vitamin Deficiency in childhood",
    "titleIsPlaceholder": false
  },
  {
    "id": "36b",
    "block": "B",
    "number": 36,
    "title": "Lysosomal Disorders",
    "titleIsPlaceholder": false
  },
  {
    "id": "36c",
    "block": "C",
    "number": 36,
    "title": "Cough, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "37a",
    "block": "A",
    "number": 37,
    "title": "Obesity, Treatment, and Complications",
    "titleIsPlaceholder": false
  },
  {
    "id": "37b",
    "block": "B",
    "number": 37,
    "title": "Perinatal Hypoxia and Asphyxia, HIE, Therapy",
    "titleIsPlaceholder": false
  },
  {
    "id": "37c",
    "block": "C",
    "number": 37,
    "title": "Cardiac Failure in children, Causes, Clinical manifestations, Treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "38a",
    "block": "A",
    "number": 38,
    "title": "Neonatal sepsis – Early and Late, Causes, Clinical Manifestations, Treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "38b",
    "block": "B",
    "number": 38,
    "title": "Intertrigo, Atopic eczema, Seborrheic dermatitis",
    "titleIsPlaceholder": false
  },
  {
    "id": "38c",
    "block": "C",
    "number": 38,
    "title": "Respiratory failure in children, Causes, Clinical manifestations, Treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "39a",
    "block": "A",
    "number": 39,
    "title": "Eating disorders",
    "titleIsPlaceholder": false
  },
  {
    "id": "39b",
    "block": "B",
    "number": 39,
    "title": "Tumours in children",
    "titleIsPlaceholder": false
  },
  {
    "id": "39c",
    "block": "C",
    "number": 39,
    "title": "Chest pain in children, Differential Diagnosis",
    "titleIsPlaceholder": false
  },
  {
    "id": "40a",
    "block": "A",
    "number": 40,
    "title": "Acute gastroenteritis in children, causes, clinical manifestations, treatment",
    "titleIsPlaceholder": false
  },
  {
    "id": "40b",
    "block": "B",
    "number": 40,
    "title": "Disorders of amino acids metabolism",
    "titleIsPlaceholder": false
  },
  {
    "id": "40c",
    "block": "C",
    "number": 40,
    "title": "Cyanosis in children, Differential Diagnosis.",
    "titleIsPlaceholder": false
  }
];
export const PAEDIATRICS_TOPIC_IDS = new Set(PAEDIATRICS_SYLLABUS.map(topic => topic.id));
export const PAEDIATRICS_RESOURCES = ['Paediatrics State Exam Questions.pdf', 'Paeds_iBook.pdf', 'Peds Lectures Transcript.pdf', 'Nelson-essentials-of-pediatrics.pdf', 'Pädiatrie Notes.pdf', 'consultation dr zeman cz en-US.pdf', 'Tips and Tricks for Zeman.pdf', 'credit-tests-final-2201-2021-1.docx'];
