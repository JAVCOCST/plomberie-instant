-- Allow custom (local-<uuid>) employee ids in dispatch_assignments by
-- changing employee_id from uuid to text so it matches qbo_employee.id (text).

ALTER TABLE public.dispatch_assignments
  ALTER COLUMN employee_id TYPE text USING employee_id::text;
