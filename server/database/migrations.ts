import type { ModuleMigration } from '../../../../server/sdk'

interface SqlExecutor {
  query: (text: string) => Promise<unknown>
}

/** SIS demo owns its tables; `IF NOT EXISTS` keeps re-runs idempotent. */
export const sisMigrations: ModuleMigration[] = [
  {
    id: 'sis-demo:001-create-tables',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sis_classes (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          name            varchar(120) NOT NULL,
          grade           varchar(40),
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sis_classes_organization_idx ON sis_classes (organization_id);

        CREATE TABLE IF NOT EXISTS sis_students (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          class_id        integer,
          name            varchar(120) NOT NULL,
          student_no      varchar(40) NOT NULL,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sis_students_organization_idx ON sis_students (organization_id);
        CREATE INDEX IF NOT EXISTS sis_students_class_idx ON sis_students (class_id);

        CREATE TABLE IF NOT EXISTS sis_teacher_assignments (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          teacher_user_id  integer NOT NULL,
          class_id         integer NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_teacher_assignments_teacher_class_idx
          ON sis_teacher_assignments (teacher_user_id, class_id);
        CREATE INDEX IF NOT EXISTS sis_teacher_assignments_organization_idx
          ON sis_teacher_assignments (organization_id);
      `)
    }
  },
  {
    id: 'sis-demo:002-tenant-ownership',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        ALTER TABLE sis_classes ADD COLUMN IF NOT EXISTS tenant_id integer;
        ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS tenant_id integer;
        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS tenant_id integer;

        UPDATE sis_classes c SET tenant_id = o.tenant_id
          FROM organizations o WHERE c.organization_id = o.id AND c.tenant_id IS NULL;
        UPDATE sis_students s SET tenant_id = o.tenant_id
          FROM organizations o WHERE s.organization_id = o.id AND s.tenant_id IS NULL;
        UPDATE sis_teacher_assignments a SET tenant_id = o.tenant_id
          FROM organizations o WHERE a.organization_id = o.id AND a.tenant_id IS NULL;

        CREATE INDEX IF NOT EXISTS sis_classes_tenant_idx ON sis_classes (tenant_id);
        CREATE INDEX IF NOT EXISTS sis_students_tenant_idx ON sis_students (tenant_id);
        CREATE INDEX IF NOT EXISTS sis_teacher_assignments_tenant_idx ON sis_teacher_assignments (tenant_id);
      `)
    }
  },
  {
    id: 'sis-demo:003-organization-unique-constraints',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      // Business keys are unique *within an organization*, not globally.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sis_students_org_student_no_idx
          ON sis_students (organization_id, student_no);
        CREATE UNIQUE INDEX IF NOT EXISTS sis_classes_org_name_idx
          ON sis_classes (organization_id, name);
        CREATE INDEX IF NOT EXISTS sis_students_org_class_idx
          ON sis_students (organization_id, class_id);
        CREATE INDEX IF NOT EXISTS sis_teacher_assignments_class_idx
          ON sis_teacher_assignments (class_id);
      `)
    }
  },
  {
    id: 'sis-demo:004-academic-domain',
    checksum: '1',
    async up(executor) {
      const client = executor as SqlExecutor
      await client.query(`
        CREATE TABLE IF NOT EXISTS sis_academic_years (
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
        CREATE UNIQUE INDEX IF NOT EXISTS sis_academic_years_org_name_idx
          ON sis_academic_years (organization_id, name);
        CREATE INDEX IF NOT EXISTS sis_academic_years_tenant_idx ON sis_academic_years (tenant_id);
        CREATE INDEX IF NOT EXISTS sis_academic_years_org_current_idx ON sis_academic_years (organization_id, is_current);

        CREATE TABLE IF NOT EXISTS sis_terms (
          id               serial PRIMARY KEY,
          organization_id  integer NOT NULL,
          tenant_id        integer,
          academic_year_id integer NOT NULL,
          name             varchar(80) NOT NULL,
          start_date       date NOT NULL,
          end_date         date NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_terms_year_name_idx ON sis_terms (academic_year_id, name);
        CREATE INDEX IF NOT EXISTS sis_terms_organization_idx ON sis_terms (organization_id);

        CREATE TABLE IF NOT EXISTS sis_grades (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          name            varchar(80) NOT NULL,
          level           integer,
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_grades_org_name_idx ON sis_grades (organization_id, name);

        CREATE TABLE IF NOT EXISTS sis_subjects (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          code            varchar(40) NOT NULL,
          name            varchar(120) NOT NULL,
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_subjects_org_code_idx ON sis_subjects (organization_id, code);

        CREATE TABLE IF NOT EXISTS sis_teachers (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          user_id         integer NOT NULL,
          name            varchar(120),
          employee_no     varchar(40),
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_teachers_org_user_idx ON sis_teachers (organization_id, user_id);

        ALTER TABLE sis_classes ADD COLUMN IF NOT EXISTS academic_year_id integer;
        ALTER TABLE sis_classes ADD COLUMN IF NOT EXISTS grade_id integer;
        ALTER TABLE sis_classes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS sis_classes_org_year_idx ON sis_classes (organization_id, academic_year_id);

        ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS user_id integer;
        ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE UNIQUE INDEX IF NOT EXISTS sis_students_org_user_idx
          ON sis_students (organization_id, user_id) WHERE user_id IS NOT NULL;

        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS teacher_id integer;
        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS subject_id integer;
        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS term_id integer;
        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS academic_year_id integer;
        ALTER TABLE sis_teacher_assignments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

        CREATE TABLE IF NOT EXISTS sis_enrollments (
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
        CREATE INDEX IF NOT EXISTS sis_enrollments_organization_idx ON sis_enrollments (organization_id);
        CREATE INDEX IF NOT EXISTS sis_enrollments_student_status_idx ON sis_enrollments (student_id, status);
        CREATE INDEX IF NOT EXISTS sis_enrollments_class_status_idx ON sis_enrollments (class_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS sis_enrollments_active_year_idx
          ON sis_enrollments (student_id, academic_year_id) WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS sis_guardians (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          user_id         integer NOT NULL,
          name            varchar(120),
          phone           varchar(40),
          deleted_at      timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_guardians_org_user_idx ON sis_guardians (organization_id, user_id);

        CREATE TABLE IF NOT EXISTS sis_student_guardians (
          id              serial PRIMARY KEY,
          organization_id integer NOT NULL,
          tenant_id       integer,
          student_id      integer NOT NULL,
          guardian_id     integer NOT NULL,
          relation        varchar(40),
          is_primary      boolean NOT NULL DEFAULT false,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sis_student_guardians_pair_idx
          ON sis_student_guardians (student_id, guardian_id);
        CREATE INDEX IF NOT EXISTS sis_student_guardians_guardian_idx
          ON sis_student_guardians (guardian_id);
      `)
    }
  }
]
