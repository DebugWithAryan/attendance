import { conflict, badRequest } from './errors.js';

const UNIQUE_MESSAGES = {
  users_login_id_key: 'That login ID is already taken.',
  students_section_id_roll_number_key: 'That roll number already exists in this section.',
  courses_name_key: 'A course with that name already exists.',
  sections_course_id_name_key: 'That section already exists in this course.',
  subjects_course_id_name_key: 'That subject already exists in this course.',
  schedule_slots_section_id_day_of_week_period_number_key: 'That period is already filled for this section.',
  schedule_slots_teacher_id_day_of_week_period_number_key:
    'That teacher already has a class in this period. Pick another teacher or period.',
  clubs_name_key: 'A club with that name already exists.',
  attendance_records_student_id_class_date_period_number_key:
    'Attendance for this period is already saved. Edit it instead.',
};

/**
 * One translator from Postgres error codes to user-facing errors, so use cases
 * stay free of `err.code === '23505'` noise.
 */
export function translatePgError(err) {
  if (err?.code === '23505') return conflict(UNIQUE_MESSAGES[err.constraint] || 'That record already exists.');
  if (err?.code === '23503') return badRequest('One of the linked records no longer exists.');
  if (err?.code === '23514') return badRequest('One of the values is out of the allowed range.');
  return err;
}

export const rethrow = (err) => {
  throw translatePgError(err);
};
