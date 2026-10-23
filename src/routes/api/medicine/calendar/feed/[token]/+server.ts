import type {RequestHandler} from './$types';
import {serveCalendar} from '$lib/server/medicine-calendar';
import {calendarDependencies} from '$lib/server/medicine-calendar-store';
export const GET:RequestHandler=({params})=>serveCalendar(params.token,calendarDependencies);
