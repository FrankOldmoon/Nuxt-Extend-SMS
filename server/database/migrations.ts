import type { ModuleMigration } from '../../../../server/sdk'

interface SqlExecutor {
  query: (text: string) => Promise<unknown>
}

/** SMS demo owns its tables; `IF NOT EXISTS` keeps re-runs idempotent. */
export const smsMigrations: ModuleMigration[] = [
  {
    id: 'sms:001-create-tables',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_classes (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          name            varchar(120) NOT NULL,
          grade           varchar(40),
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_classes_organization_idx ON sms_classes (organization_id);

        CREATE TABLE IF NOT EXISTS sms_students (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          class_id        integer,
          name            varchar(120) NOT NULL,
          student_no      varchar(40) NOT NULL,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_students_organization_idx ON sms_students (organization_id);
        CREATE INDEX IF NOT EXISTS sms_students_class_idx ON sms_students (class_id);

        CREATE TABLE IF NOT EXISTS sms_teacher_assignments (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          teacher_user_id  integer NOT NULL,
          class_id         integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_teacher_assignments_teacher_class_idx
          ON sms_teacher_assignments (teacher_user_id, class_id);
        CREATE INDEX IF NOT EXISTS sms_teacher_assignments_organization_idx
          ON sms_teacher_assignments (organization_id);
      `)
    }
  },
  {
    id: 'sms:002-tenant-ownership',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        ALTER TABLE sms_classes ADD COLUMN IF NOT EXISTS tenant_id integer;
        ALTER TABLE sms_students ADD COLUMN IF NOT EXISTS tenant_id integer;
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS tenant_id integer;

        UPDATE sms_classes c SET tenant_id = o.tenant_id
          FROM organizations o WHERE c.organization_id = o.id AND c.tenant_id IS NULL;
        UPDATE sms_students s SET tenant_id = o.tenant_id
          FROM organizations o WHERE s.organization_id = o.id AND s.tenant_id IS NULL;
        UPDATE sms_teacher_assignments a SET tenant_id = o.tenant_id
          FROM organizations o WHERE a.organization_id = o.id AND a.tenant_id IS NULL;

        CREATE INDEX IF NOT EXISTS sms_classes_tenant_idx ON sms_classes (tenant_id);
        CREATE INDEX IF NOT EXISTS sms_students_tenant_idx ON sms_students (tenant_id);
        CREATE INDEX IF NOT EXISTS sms_teacher_assignments_tenant_idx ON sms_teacher_assignments (tenant_id);
      `)
    }
  },
  {
    id: 'sms:003-organization-unique-constraints',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      // Business keys are unique *within an organization*, not globally.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sms_students_org_student_no_idx
          ON sms_students (organization_id, student_no);
        CREATE UNIQUE INDEX IF NOT EXISTS sms_classes_org_name_idx
          ON sms_classes (organization_id, name);
        CREATE INDEX IF NOT EXISTS sms_students_org_class_idx
          ON sms_students (organization_id, class_id);
        CREATE INDEX IF NOT EXISTS sms_teacher_assignments_class_idx
          ON sms_teacher_assignments (class_id);
      `)
    }
  },
  {
    id: 'sms:004-academic-domain',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_academic_years (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          name            varchar(80) NOT NULL,
          start_date      date NOT NULL,
          end_date        date NOT NULL,
          is_current      boolean NOT NULL DEFAULT false,
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_academic_years_org_name_idx
          ON sms_academic_years (organization_id, name);
        CREATE INDEX IF NOT EXISTS sms_academic_years_tenant_idx ON sms_academic_years (tenant_id);
        CREATE INDEX IF NOT EXISTS sms_academic_years_org_current_idx ON sms_academic_years (organization_id, is_current);

        CREATE TABLE IF NOT EXISTS sms_terms (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          academic_year_id integer NOT NULL,
          name             varchar(80) NOT NULL,
          start_date       date NOT NULL,
          end_date         date NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_terms_year_name_idx ON sms_terms (academic_year_id, name);
        CREATE INDEX IF NOT EXISTS sms_terms_organization_idx ON sms_terms (organization_id);

        CREATE TABLE IF NOT EXISTS sms_grades (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          name            varchar(80) NOT NULL,
          level           integer,
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_grades_org_name_idx ON sms_grades (organization_id, name);

        CREATE TABLE IF NOT EXISTS sms_subjects (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          code            varchar(40) NOT NULL,
          name            varchar(120) NOT NULL,
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_subjects_org_code_idx ON sms_subjects (organization_id, code);

        CREATE TABLE IF NOT EXISTS sms_teachers (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          user_id         integer NOT NULL,
          name            varchar(120),
          employee_no     varchar(40),
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_teachers_org_user_idx ON sms_teachers (organization_id, user_id);

        ALTER TABLE sms_classes ADD COLUMN IF NOT EXISTS academic_year_id integer;
        ALTER TABLE sms_classes ADD COLUMN IF NOT EXISTS grade_id integer;
        ALTER TABLE sms_classes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS sms_classes_org_year_idx ON sms_classes (organization_id, academic_year_id);

        ALTER TABLE sms_students ADD COLUMN IF NOT EXISTS user_id integer;
        ALTER TABLE sms_students ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE UNIQUE INDEX IF NOT EXISTS sms_students_org_user_idx
          ON sms_students (organization_id, user_id) WHERE user_id IS NOT NULL;

        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS teacher_id integer;
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS subject_id integer;
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS term_id integer;
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS academic_year_id integer;
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

        CREATE TABLE IF NOT EXISTS sms_enrollments (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          student_id       integer NOT NULL,
          class_id         integer NOT NULL,
          academic_year_id integer NOT NULL,
          term_id          integer,
          status           varchar(20) NOT NULL DEFAULT 'active',
          enrolled_at      timestamptz NOT NULL DEFAULT now(),
          ended_at         timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_enrollments_organization_idx ON sms_enrollments (organization_id);
        CREATE INDEX IF NOT EXISTS sms_enrollments_student_status_idx ON sms_enrollments (student_id, status);
        CREATE INDEX IF NOT EXISTS sms_enrollments_class_status_idx ON sms_enrollments (class_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS sms_enrollments_active_year_idx
          ON sms_enrollments (student_id, academic_year_id) WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS sms_guardians (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          user_id         integer NOT NULL,
          name            varchar(120),
          phone           varchar(40),
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_guardians_org_user_idx ON sms_guardians (organization_id, user_id);

        CREATE TABLE IF NOT EXISTS sms_student_guardians (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          student_id      integer NOT NULL,
          guardian_id     integer NOT NULL,
          relation        varchar(40),
          is_primary      boolean NOT NULL DEFAULT false,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_student_guardians_pair_idx
          ON sms_student_guardians (student_id, guardian_id);
        CREATE INDEX IF NOT EXISTS sms_student_guardians_guardian_idx
          ON sms_student_guardians (guardian_id);
      `)
    }
  },
  {
    id: 'sms:005-attendance',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        -- Homeroom ownership drives the \`homeroomClass\` data scope.
        ALTER TABLE sms_classes ADD COLUMN IF NOT EXISTS homeroom_user_id integer;
        CREATE INDEX IF NOT EXISTS sms_classes_homeroom_idx
          ON sms_classes (organization_id, homeroom_user_id);

        -- A teacher can now be homeroom *and* subject teacher in the same class.
        ALTER TABLE sms_teacher_assignments ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'subject';
        UPDATE sms_teacher_assignments SET role = 'subject' WHERE role IS NULL;
        DROP INDEX IF EXISTS sms_teacher_assignments_teacher_class_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS sms_teacher_assignments_scope_idx
          ON sms_teacher_assignments (teacher_user_id, class_id, role, COALESCE(subject_id, 0));

        CREATE TABLE IF NOT EXISTS sms_attendance_records (
          id                serial PRIMARY KEY,
          organization_id   integer NOT NULL,
          tenant_id         integer,
          term_id           integer,
          class_id          integer NOT NULL,
          student_id        integer NOT NULL,
          attendance_date   date NOT NULL,
          session           varchar(20) NOT NULL DEFAULT 'full_day',
          period_no         integer,
          status            varchar(20) NOT NULL,
          leave_request_id  integer,
          remark            varchar(255),
          recorded_by       integer NOT NULL,
          recorded_at       timestamptz NOT NULL DEFAULT now(),
          updated_at        timestamptz NOT NULL DEFAULT now(),
          created_at        timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_attendance_unique_idx
          ON sms_attendance_records (organization_id, student_id, attendance_date, session, COALESCE(period_no, 0));
        CREATE INDEX IF NOT EXISTS sms_attendance_class_date_idx
          ON sms_attendance_records (organization_id, class_id, attendance_date);
        CREATE INDEX IF NOT EXISTS sms_attendance_student_date_idx
          ON sms_attendance_records (organization_id, student_id, attendance_date);

        CREATE TABLE IF NOT EXISTS sms_attendance_alerts (
          id                serial PRIMARY KEY,
          organization_id   integer NOT NULL,
          tenant_id         integer,
          student_id        integer NOT NULL,
          rule              varchar(40) NOT NULL,
          window_start      date NOT NULL,
          window_end        date NOT NULL,
          metric            numeric(6,2) NOT NULL,
          threshold         numeric(6,2) NOT NULL,
          status            varchar(20) NOT NULL DEFAULT 'open',
          acknowledged_by   integer,
          acknowledged_at   timestamptz,
          created_at        timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_attendance_alerts_unique_idx
          ON sms_attendance_alerts (organization_id, student_id, rule, window_start);
        CREATE INDEX IF NOT EXISTS sms_attendance_alerts_status_idx
          ON sms_attendance_alerts (organization_id, status);
      `)
    }
  },
  {
    id: 'sms:006-leave',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_leave_requests (
          id                  serial PRIMARY KEY,
          organization_id     integer NOT NULL,
          tenant_id           integer,
          subject_type        varchar(20) NOT NULL DEFAULT 'student',
          student_id          integer,
          staff_user_id       integer,
          applicant_user_id   integer NOT NULL,
          type                varchar(20) NOT NULL,
          start_at            timestamptz NOT NULL,
          end_at              timestamptz NOT NULL,
          reason              varchar(500),
          attachment_file_id  integer,
          status              varchar(20) NOT NULL DEFAULT 'pending',
          decided_by          integer,
          decided_at          timestamptz,
          decision_note       varchar(255),
          created_at          timestamptz NOT NULL DEFAULT now(),
          updated_at          timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_leave_student_idx
          ON sms_leave_requests (organization_id, student_id, start_at);
        CREATE INDEX IF NOT EXISTS sms_leave_status_idx
          ON sms_leave_requests (organization_id, status, created_at);
        CREATE INDEX IF NOT EXISTS sms_leave_applicant_idx
          ON sms_leave_requests (organization_id, applicant_user_id, created_at);

        CREATE TABLE IF NOT EXISTS sms_approval_tasks (
          id                serial PRIMARY KEY,
          organization_id   integer NOT NULL,
          tenant_id         integer,
          subject_type      varchar(40) NOT NULL,
          subject_id        integer NOT NULL,
          step              integer NOT NULL DEFAULT 1,
          assignee_user_id  integer,
          assignee_role     varchar(80),
          status            varchar(20) NOT NULL DEFAULT 'pending',
          comment           varchar(500),
          decided_by        integer,
          decided_at        timestamptz,
          created_at        timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_approval_tasks_unique_idx
          ON sms_approval_tasks (organization_id, subject_type, subject_id, step);
        CREATE INDEX IF NOT EXISTS sms_approval_tasks_assignee_idx
          ON sms_approval_tasks (organization_id, assignee_user_id, status);
      `)
    }
  },
  {
    id: 'sms:007-exams',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_exams (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          term_id          integer,
          subject_id       integer,
          class_id         integer NOT NULL,
          name             varchar(120) NOT NULL,
          exam_type        varchar(40) NOT NULL DEFAULT 'regular',
          exam_date        date NOT NULL,
          full_score       numeric(5,2) NOT NULL DEFAULT 100,
          status           varchar(20) NOT NULL DEFAULT 'draft',
          created_by       integer NOT NULL,
          published_by     integer,
          published_at     timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_exams_class_date_idx
          ON sms_exams (organization_id, class_id, exam_date);
        CREATE INDEX IF NOT EXISTS sms_exams_status_idx
          ON sms_exams (organization_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS sms_exams_org_class_name_idx
          ON sms_exams (organization_id, class_id, name);

        CREATE TABLE IF NOT EXISTS sms_exam_scores (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          exam_id          integer NOT NULL,
          student_id       integer NOT NULL,
          score            numeric(5,2),
          absent           boolean NOT NULL DEFAULT false,
          remark           varchar(255),
          recorded_by      integer NOT NULL,
          recorded_at      timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now(),
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_exam_scores_exam_student_idx
          ON sms_exam_scores (organization_id, exam_id, student_id);
        CREATE INDEX IF NOT EXISTS sms_exam_scores_student_idx
          ON sms_exam_scores (organization_id, student_id);

        CREATE TABLE IF NOT EXISTS sms_score_revisions (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          exam_id          integer NOT NULL,
          score_id         integer NOT NULL,
          student_id       integer NOT NULL,
          before_score     numeric(5,2),
          after_score      numeric(5,2),
          before_absent    boolean,
          after_absent     boolean,
          reason           varchar(255),
          revised_by       integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_score_revisions_exam_idx
          ON sms_score_revisions (organization_id, exam_id, created_at);

        CREATE TABLE IF NOT EXISTS sms_report_cards (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          student_id       integer NOT NULL,
          term_id          integer,
          payload          jsonb NOT NULL,
          generated_by     integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_report_cards_student_idx
          ON sms_report_cards (organization_id, student_id, created_at);
      `)
    }
  },
  {
    id: 'sms:008-admissions',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_admission_cycles (
          id                serial PRIMARY KEY,
          organization_id   integer NOT NULL,
          tenant_id         integer,
          academic_year_id  integer NOT NULL,
          name              varchar(120) NOT NULL,
          start_date        date NOT NULL,
          end_date          date NOT NULL,
          status            varchar(20) NOT NULL DEFAULT 'open',
          created_at        timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_admission_cycles_org_name_idx
          ON sms_admission_cycles (organization_id, name);
        CREATE INDEX IF NOT EXISTS sms_admission_cycles_status_idx
          ON sms_admission_cycles (organization_id, status);

        CREATE TABLE IF NOT EXISTS sms_admission_applications (
          id                   serial PRIMARY KEY,
          organization_id      integer NOT NULL,
          tenant_id            integer,
          cycle_id             integer NOT NULL,
          applicant_name       varchar(120) NOT NULL,
          gender               varchar(20),
          birth_date           date,
          guardian_name        varchar(120),
          guardian_phone       varchar(40),
          previous_school      varchar(160),
          status               varchar(20) NOT NULL DEFAULT 'submitted',
          student_no           varchar(40),
          notes                varchar(500),
          reviewed_by          integer,
          reviewed_at          timestamptz,
          converted_student_id integer,
          created_by           integer NOT NULL,
          created_at           timestamptz NOT NULL DEFAULT now(),
          updated_at           timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_admission_applications_cycle_status_idx
          ON sms_admission_applications (organization_id, cycle_id, status);
        CREATE INDEX IF NOT EXISTS sms_admission_applications_phone_idx
          ON sms_admission_applications (organization_id, guardian_phone);

        CREATE TABLE IF NOT EXISTS sms_admission_events (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          application_id   integer NOT NULL,
          action           varchar(40) NOT NULL,
          from_status      varchar(20),
          to_status        varchar(20),
          note             varchar(500),
          actor_user_id    integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_admission_events_application_idx
          ON sms_admission_events (organization_id, application_id, created_at);
      `)
    }
  },
  {
    id: 'sms:009-timetable',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_timetable_entries (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          term_id          integer,
          class_id         integer NOT NULL,
          subject_id       integer,
          teacher_user_id  integer,
          weekday          integer NOT NULL,
          period_no        integer NOT NULL,
          room             varchar(40),
          status           varchar(20) NOT NULL DEFAULT 'draft',
          created_by       integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_timetable_entries_class_slot_idx
          ON sms_timetable_entries (organization_id, class_id, weekday, period_no, COALESCE(term_id, 0));
        CREATE INDEX IF NOT EXISTS sms_timetable_entries_teacher_slot_idx
          ON sms_timetable_entries (organization_id, teacher_user_id, weekday, period_no);
        CREATE INDEX IF NOT EXISTS sms_timetable_entries_status_idx
          ON sms_timetable_entries (organization_id, status);
      `)
    }
  },
  {
    id: 'sms:010-finance',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_fee_items (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          name             varchar(120) NOT NULL,
          amount           numeric(12,2) NOT NULL,
          term_id          integer,
          grade_id         integer,
          due_date         date,
          status           varchar(20) NOT NULL DEFAULT 'active',
          created_by       integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_fee_items_name_idx ON sms_fee_items (organization_id, name);
        CREATE INDEX IF NOT EXISTS sms_fee_items_status_idx ON sms_fee_items (organization_id, status);

        CREATE TABLE IF NOT EXISTS sms_invoices (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          student_id       integer NOT NULL,
          fee_item_id      integer NOT NULL,
          amount           numeric(12,2) NOT NULL,
          discount         numeric(12,2) NOT NULL DEFAULT 0,
          payable          numeric(12,2) NOT NULL,
          paid             numeric(12,2) NOT NULL DEFAULT 0,
          status           varchar(20) NOT NULL DEFAULT 'unpaid',
          due_date         date,
          created_by       integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_invoices_student_item_idx
          ON sms_invoices (organization_id, student_id, fee_item_id);
        CREATE INDEX IF NOT EXISTS sms_invoices_status_idx ON sms_invoices (organization_id, status);

        CREATE TABLE IF NOT EXISTS sms_payments (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          invoice_id       integer NOT NULL,
          amount           numeric(12,2) NOT NULL,
          method           varchar(20) NOT NULL DEFAULT 'cash',
          reference        varchar(80),
          paid_at          timestamptz NOT NULL DEFAULT now(),
          received_by      integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_payments_invoice_idx
          ON sms_payments (organization_id, invoice_id, created_at);

        CREATE TABLE IF NOT EXISTS sms_refunds (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          payment_id       integer NOT NULL,
          invoice_id       integer NOT NULL,
          amount           numeric(12,2) NOT NULL,
          reason           varchar(255),
          status           varchar(20) NOT NULL DEFAULT 'pending',
          requested_by     integer NOT NULL,
          approved_by      integer,
          approved_at      timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_refunds_payment_idx
          ON sms_refunds (organization_id, payment_id, status);
        CREATE INDEX IF NOT EXISTS sms_refunds_status_idx ON sms_refunds (organization_id, status);
      `)
    }
  },
  {
    id: 'sms:011-assets-library',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_assets (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          asset_no         varchar(40) NOT NULL,
          name             varchar(120) NOT NULL,
          category         varchar(60),
          status           varchar(20) NOT NULL DEFAULT 'idle',
          assigned_user_id integer,
          location         varchar(120),
          purchased_at     date,
          value            numeric(12,2),
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_assets_org_no_idx ON sms_assets (organization_id, asset_no);
        CREATE INDEX IF NOT EXISTS sms_assets_status_idx ON sms_assets (organization_id, status);

        CREATE TABLE IF NOT EXISTS sms_asset_events (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          asset_id         integer NOT NULL,
          action           varchar(40) NOT NULL,
          from_status      varchar(20),
          to_status        varchar(20),
          note             varchar(255),
          actor_user_id    integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_asset_events_asset_idx
          ON sms_asset_events (organization_id, asset_id, created_at);

        CREATE TABLE IF NOT EXISTS sms_books (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          title            varchar(160) NOT NULL,
          author           varchar(120),
          isbn             varchar(20),
          category         varchar(60),
          total_copies     integer NOT NULL DEFAULT 1,
          available_copies integer NOT NULL DEFAULT 1,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_books_isbn_idx ON sms_books (organization_id, isbn);
        CREATE INDEX IF NOT EXISTS sms_books_title_idx ON sms_books (organization_id, title);

        CREATE TABLE IF NOT EXISTS sms_book_loans (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          book_id          integer NOT NULL,
          student_id       integer NOT NULL,
          borrowed_at      timestamptz NOT NULL DEFAULT now(),
          due_at           timestamptz NOT NULL,
          returned_at      timestamptz,
          status           varchar(20) NOT NULL DEFAULT 'borrowed',
          created_by       integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_book_loans_student_idx
          ON sms_book_loans (organization_id, student_id, status);
        CREATE INDEX IF NOT EXISTS sms_book_loans_book_idx
          ON sms_book_loans (organization_id, book_id, status);
      `)
    }
  },
  {
    id: 'sms:012-report-runs',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_report_runs (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          kind             varchar(40) NOT NULL,
          period_start     date NOT NULL,
          period_end       date NOT NULL,
          status           varchar(20) NOT NULL DEFAULT 'succeeded',
          payload          jsonb,
          error            varchar(500),
          generated_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_report_runs_period_idx
          ON sms_report_runs (organization_id, kind, period_start);
      `)
    }
  },
  {
    id: 'sms:013-notifications',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_notifications (
          id                 serial PRIMARY KEY,
          organization_id    integer NOT NULL,
          tenant_id          integer,
          recipient_user_id  integer NOT NULL,
          category           varchar(40) NOT NULL DEFAULT 'system',
          title              varchar(160) NOT NULL,
          body               varchar(1000),
          link               varchar(255),
          entity_type        varchar(40),
          entity_id          integer,
          status             varchar(20) NOT NULL DEFAULT 'unread',
          read_at            timestamptz,
          created_at         timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_notifications_recipient_idx
          ON sms_notifications (organization_id, recipient_user_id, status, created_at);
        CREATE INDEX IF NOT EXISTS sms_notifications_org_created_idx
          ON sms_notifications (organization_id, created_at);
      `)
    }
  },
  {
    id: 'sms:014-approval-escalation',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        ALTER TABLE sms_approval_tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
        ALTER TABLE sms_approval_tasks ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
        UPDATE sms_approval_tasks
           SET due_at = created_at + interval '48 hours'
         WHERE due_at IS NULL AND status = 'pending';
        CREATE INDEX IF NOT EXISTS sms_approval_tasks_due_idx
          ON sms_approval_tasks (organization_id, status, due_at);
      `)
    }
  },
  {
    id: 'sms:015-knowledge-base',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_knowledge_articles (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          title            varchar(200) NOT NULL,
          content          text NOT NULL,
          tags             varchar(255),
          audience         varchar(20) NOT NULL DEFAULT 'all',
          status           varchar(20) NOT NULL DEFAULT 'published',
          created_by       integer NOT NULL,
          updated_at       timestamptz NOT NULL DEFAULT now(),
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_knowledge_articles_org_status_idx
          ON sms_knowledge_articles (organization_id, status, updated_at);
        CREATE INDEX IF NOT EXISTS sms_knowledge_articles_title_idx
          ON sms_knowledge_articles (organization_id, title);
      `)
    }
  },
  {
    id: 'sms:016-report-daily',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_report_daily (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          report_date      date NOT NULL,
          class_id         integer NOT NULL DEFAULT 0,
          present          integer NOT NULL DEFAULT 0,
          late             integer NOT NULL DEFAULT 0,
          absent           integer NOT NULL DEFAULT 0,
          leave            integer NOT NULL DEFAULT 0,
          total            integer NOT NULL DEFAULT 0,
          generated_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_report_daily_unique_idx
          ON sms_report_daily (organization_id, report_date, class_id);
      `)
    }
  },
  {
    id: 'sms:017-agent-tasks',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_agent_tasks (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          owner_user_id    integer NOT NULL,
          title            varchar(200) NOT NULL,
          goal             varchar(2000),
          status           varchar(30) NOT NULL DEFAULT 'pending',
          step             integer NOT NULL DEFAULT 0,
          max_steps        integer NOT NULL DEFAULT 8,
          payload          jsonb,
          result           jsonb,
          last_error       varchar(500),
          updated_at       timestamptz NOT NULL DEFAULT now(),
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_agent_tasks_owner_idx
          ON sms_agent_tasks (organization_id, owner_user_id, status, updated_at);
      `)
    }
  },
  {
    id: 'sms:018-teaching',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_assignments (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          class_id         integer NOT NULL,
          subject_id       integer NOT NULL,
          title            varchar(200) NOT NULL,
          description      text,
          due_at           timestamptz,
          status           varchar(20) NOT NULL DEFAULT 'draft',
          created_by       integer NOT NULL,
          updated_at       timestamptz NOT NULL DEFAULT now(),
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_assignments_class_idx
          ON sms_assignments (organization_id, class_id, status, due_at);

        CREATE TABLE IF NOT EXISTS sms_assignment_submissions (
          id             serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id      integer,
          assignment_id  integer NOT NULL,
          student_id     integer NOT NULL,
          content        text,
          status         varchar(20) NOT NULL DEFAULT 'submitted',
          score          numeric(6,2),
          feedback       varchar(500),
          submitted_at   timestamptz NOT NULL DEFAULT now(),
          graded_by      integer,
          graded_at      timestamptz
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_assignment_submissions_unique_idx
          ON sms_assignment_submissions (organization_id, assignment_id, student_id);

        CREATE TABLE IF NOT EXISTS sms_course_elections (
          id             serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id      integer,
          student_id     integer NOT NULL,
          subject_id     integer NOT NULL,
          term_id        integer NOT NULL,
          status         varchar(20) NOT NULL DEFAULT 'selected',
          elected_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_course_elections_unique_idx
          ON sms_course_elections (organization_id, student_id, subject_id, term_id);
      `)
    }
  },
  {
    id: 'sms:019-optimization',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        ALTER TABLE sms_subjects ADD COLUMN IF NOT EXISTS capacity integer;
        ALTER TABLE sms_assignments ADD COLUMN IF NOT EXISTS rubric jsonb;
        ALTER TABLE sms_assignment_submissions ADD COLUMN IF NOT EXISTS attachment_url varchar(500);
        ALTER TABLE sms_agent_tasks ADD COLUMN IF NOT EXISTS idempotency_key varchar(80);

        CREATE UNIQUE INDEX IF NOT EXISTS sms_agent_tasks_idempotency_idx
          ON sms_agent_tasks (organization_id, idempotency_key);

        CREATE TABLE IF NOT EXISTS sms_notification_preferences (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          user_id          integer NOT NULL,
          category         varchar(40) NOT NULL,
          muted            boolean NOT NULL DEFAULT false,
          updated_at       timestamptz NOT NULL DEFAULT now(),
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sms_notification_preferences_unique_idx
          ON sms_notification_preferences (organization_id, user_id, category);

        CREATE TABLE IF NOT EXISTS sms_agent_task_events (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          task_id          integer NOT NULL,
          event            varchar(40) NOT NULL,
          from_status      varchar(30),
          to_status        varchar(30),
          note             varchar(500),
          actor_user_id    integer,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_agent_task_events_task_idx
          ON sms_agent_task_events (organization_id, task_id, created_at);

        CREATE TABLE IF NOT EXISTS sms_evaluation_metrics (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          metric           varchar(80) NOT NULL,
          value            numeric(12,4) NOT NULL,
          labels           jsonb,
          recorded_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_evaluation_metrics_metric_idx
          ON sms_evaluation_metrics (organization_id, metric, recorded_at);
      `)

      // pg_trgm 是可选扩展：无权限时跳过索引，关键词检索仍可回退到 ILIKE。
      await client.query(`
        DO $$
        BEGIN
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END $$;

        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
            CREATE INDEX IF NOT EXISTS sms_knowledge_articles_title_trgm_idx
              ON sms_knowledge_articles USING gin (title gin_trgm_ops);
            CREATE INDEX IF NOT EXISTS sms_knowledge_articles_content_trgm_idx
              ON sms_knowledge_articles USING gin (content gin_trgm_ops);
          END IF;
        END $$;
      `)
    }
  },
  {
    id: 'sms:020-reliability',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_notification_outbox (
          id               serial PRIMARY KEY,
          organization_id  integer,
          tenant_id        integer,
          channel          varchar(20) NOT NULL DEFAULT 'webhook',
          payload          jsonb NOT NULL,
          status           varchar(20) NOT NULL DEFAULT 'pending',
          attempts         integer NOT NULL DEFAULT 0,
          max_attempts     integer NOT NULL DEFAULT 5,
          next_attempt_at  timestamptz NOT NULL DEFAULT now(),
          last_error       varchar(500),
          delivered_at     timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_notification_outbox_due_idx
          ON sms_notification_outbox (status, next_attempt_at);

        ALTER TABLE sms_assignment_submissions ADD COLUMN IF NOT EXISTS attachment_file_id integer;
        ALTER TABLE sms_knowledge_articles ADD COLUMN IF NOT EXISTS embedding jsonb;

        CREATE TABLE IF NOT EXISTS sms_background_jobs (
          id               serial PRIMARY KEY,
          organization_id  integer,
          kind             varchar(40) NOT NULL,
          payload          jsonb NOT NULL,
          status           varchar(20) NOT NULL DEFAULT 'pending',
          attempts         integer NOT NULL DEFAULT 0,
          max_attempts     integer NOT NULL DEFAULT 3,
          next_attempt_at  timestamptz NOT NULL DEFAULT now(),
          last_error       varchar(500),
          result           jsonb,
          finished_at      timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sms_background_jobs_due_idx
          ON sms_background_jobs (status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS sms_background_jobs_kind_idx
          ON sms_background_jobs (kind, status);
        CREATE INDEX IF NOT EXISTS sms_background_jobs_org_idx
          ON sms_background_jobs (organization_id, status);

        CREATE INDEX IF NOT EXISTS sms_assignment_submissions_student_idx
          ON sms_assignment_submissions (organization_id, student_id);
      `)
    }
  }
]
