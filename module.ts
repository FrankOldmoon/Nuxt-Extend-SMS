import type {
  ModuleApiRouter,
  ModuleDefinition,
  ToolRegistry,
  UiRegistry
} from '../../server/sdk'
import type { SisActor } from './server/context'
import { sisMigrations } from './server/database/migrations'

export const sisDemoModule: ModuleDefinition = {
  id: 'sis-demo',
  name: 'SIS Demo',
  version: '1.0.0',
  apiVersion: '1',
  compatibility: { core: '^1.0.0' },
  migrationScope: 'global',
  capabilities: { multiTenant: true },
  dependencies: [],
  permissions: [
    'sis:read',
    'sis:create',
    'sis:update',
    'sis.students.read',
    'sis.students.create',
    'sis.enrollments.read',
    'sis.enrollments.create',
    'sis.teacher-assignments.create',
    'sis.academic-years.read',
    'sis.academic-years.create'
  ],
  navigation: [{ id: 'sis', label: 'SIS', to: '/sis' }],
  database: [
    'sis_academic_years',
    'sis_terms',
    'sis_grades',
    'sis_subjects',
    'sis_teachers',
    'sis_classes',
    'sis_students',
    'sis_teacher_assignments',
    'sis_enrollments',
    'sis_guardians',
    'sis_student_guardians'
  ],
  api: ['GET /api/modules/sis-demo/students'],
  tools: ['sis.students.search'],
  components: ['sis.student-table'],
  migrations: sisMigrations,
  async register(context) {
    const { registerSisModule } = await import('./register')
    registerSisModule({
      api: context.api as unknown as ModuleApiRouter<SisActor>,
      tools: context.tools as unknown as ToolRegistry<SisActor>,
      ui: context.ui as unknown as UiRegistry<unknown, unknown>
    })
  }
}
