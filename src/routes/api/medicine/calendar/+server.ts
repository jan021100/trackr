import type {RequestHandler} from './$types';
import {manageCalendar} from '$lib/server/medicine-calendar';
import {calendarDependencies} from '$lib/server/medicine-calendar-store';
export const GET:RequestHandler=({request})=>manageCalendar(request,calendarDependencies);
export const POST=GET;
export const DELETE=GET;
