import type {
  ModuleApiRouter,
  ModuleDefinition,
  ToolRegistry,
  UiRegistry
} from '../../server/sdk'
import type { SmsActor } from './server/context'
import { smsMigrations } from './server/database/migrations'

export const smsModule: ModuleDefinition = {
  id: 'sms',
  name: 'SMS',
  version: '1.0.0',
  apiVersion: '1',
  compatibility: { core: '^1.0.0' },
  migrationScope: 'global',
  capabilities: { multiTenant: true },
  dependencies: [],
  permissions: [
    'sms:read',
    'sms:create',
    'sms:update',
    'sms.students.read',
    'sms.students.create',
    'sms.enrollments.read',
    'sms.enrollments.create',
    'sms.teacher-assignments.create',
    'sms.academic-years.read',
    'sms.academic-years.create'
  ],
  navigation: [{ id: 'sms', label: 'SMS', to: '/sms' }],
  database: [
    'sms_academic_years',
    'sms_terms',
    'sms_grades',
    'sms_subjects',
    'sms_teachers',
    'sms_classes',
    'sms_students',
    'sms_teacher_assignments',
    'sms_enrollments',
    'sms_guardians',
    'sms_student_guardians'
  ],
  api: ['GET /api/modules/sms/students'],
  tools: ['sms.students.search'],
  components: ['sms.student-table'],
  migrations: smsMigrations,
  async register(context) {
    const { registerSmsModule } = await import('./register')
    registerSmsModule({
      api: context.api as unknown as ModuleApiRouter<SmsActor>,
      tools: context.tools as unknown as ToolRegistry<SmsActor>,
      ui: context.ui as unknown as UiRegistry<unknown, unknown>
    })
  }
}
