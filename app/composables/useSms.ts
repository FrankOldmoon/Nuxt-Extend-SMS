/**
 * School module — client types and shared display helpers.
 *
 * These mirror the DTOs the API returns (`server/utils/dto.ts`); keeping one copy
 * here means components can be typed without importing server code.
 *
 * Date handling, which is worth stating once because it differs from the photo
 * module: `date` columns (`birthday`, an attendance date, a conduct date) are
 * *calendar dates* and travel as `YYYY-MM-DD` strings, which is what a school
 * means by a date. Timestamps (`publishedAt`, `dueAt`, `submittedAt`) are real
 * instants and are formatted in the viewer's own timezone.
 */

// ============================================================== people =====

export interface Student {
  id: number
  userId: number
  name: string
  email: string | null
  avatarPath: string | null
  rollId: string
  status: 'enrolled' | 'graduated' | 'left' | 'suspended' | string
  gender: string | null
  birthday: string | null
  enrolledAt: string | null
  photo: string | null
  address: string | null
  note: string | null
  classId: number | null
  className: string | null
  gradeId: number | null
  gradeName: string | null
  departmentName: string | null
}

export interface Teacher {
  id: number
  userId: number
  name: string
  email: string | null
  avatarPath: string | null
  employeeNo: string | null
  title: string | null
  isForeign: boolean
  hiredAt: string | null
  note: string | null
  departmentId: number | null
  departmentName: string | null
  courseCount: number
}

export interface Guardian {
  id: number
  userId: number | null
  name: string
  relation: string | null
  phone: string | null
  email: string | null
  occupation: string | null
  company: string | null
  address: string | null
  students: Array<{ id: number, name: string, rollId: string, className: string | null, isPrimary: boolean }>
}

// ========================================================== structure ======

export interface SchoolClass {
  id: number
  name: string
  code: string | null
  capacity: number | null
  isGraduated: boolean
  gradeId: number | null
  gradeName: string | null
  departmentId: number | null
  departmentName: string | null
  headTeacherId: number | null
  headTeacherName: string | null
  classroomId: number | null
  classroomName: string | null
  studentCount: number
}

export interface Department {
  id: number
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  gradeCount: number
  teacherCount: number
}

export interface Grade {
  id: number
  name: string
  code: string | null
  sortOrder: number
  departmentId: number | null
  departmentName: string | null
  classCount: number
  studentCount: number
}

export interface Subject {
  id: number
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  courseCount: number
}

export interface Semester {
  id: number
  name: string
  code: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  courseCount: number
}

export interface Classroom {
  id: number
  name: string
  code: string | null
  building: string | null
  seats: number | null
  kind: string
}

export interface Period {
  id: number
  name: string
  index: number
  startTime: string | null
  endTime: string | null
  kind: 'class' | 'break' | string
}

// ============================================================ courses ======

export interface CourseTeacherRef {
  teacherId: number
  name: string
  role: 'lead' | 'assistant' | string
}

export interface Course {
  id: number
  name: string
  code: string | null
  description: string | null
  cover: string | null
  credits: number
  isGraded: boolean
  subjectId: number | null
  subjectName: string | null
  classId: number | null
  className: string | null
  departmentId: number | null
  departmentName: string | null
  semesterId: number | null
  semesterName: string | null
  classroomId: number | null
  classroomName: string | null
  studentCount: number
  assessmentCount: number
  teachers: CourseTeacherRef[]
}

// ========================================================== timetable ======

export interface TimetableEntry {
  id: number
  courseId: number
  courseName: string
  subjectName: string | null
  classId: number | null
  className: string | null
  semesterId: number | null
  periodId: number
  periodName: string | null
  weekday: number
  classroomId: number | null
  classroomName: string | null
  teacherIds: number[]
  teacherNames: string[]
  note: string | null
}

export interface TimetableConflict {
  kind: 'teacher' | 'classroom' | 'class'
  key: number
  weekday: number
  periodId: number
  entryIds: number[]
  /** Display name of the resource, resolved by the server for the message. */
  label: string | null
}

export interface TimetableResponse {
  periods: Period[]
  weekdays: number[]
  entries: TimetableEntry[]
  conflicts: TimetableConflict[]
  /** `{ rows: [{ period, cells: TimetableEntry[][] }] }` — ready to render. */
  grid: Array<{ period: Period, cells: TimetableEntry[][] }>
  scope: { kind: 'class' | 'teacher' | 'room' | 'all', id: number | null, name: string | null }
  semesterId: number | null
}

// ======================================================== assessments ======

export interface Assessment {
  id: number
  courseId: number
  semesterId: number | null
  name: string
  kind: 'usual' | 'homework' | 'quiz' | 'midterm' | 'final' | 'project' | 'other' | string
  weight: number
  maxScore: number
  dueAt: string | null
  description: string | null
  sortOrder: number
  markedCount: number
  studentCount: number
}

export interface ScoreRow {
  studentId: number
  studentName: string
  rollId: string
  scoreId: number | null
  score: number | null
  comment: string | null
}

export interface GradebookStudentRow extends ScoreRow {
  total: number | null
  coverage: number
  letter: string | null
  rank: number | null
  marked: number
  missing: number
  /**
   * Every cell for this student — a grid needs all of them, while the shared
   * `ScoreRow` only names one. The single `score`/`scoreId` fields mirror the
   * first assessment so they are never a lie.
   */
  scores: Array<{ assessmentId: number, scoreId: number | null, score: number | null, comment: string | null }>
}

export interface Gradebook {
  course: Course
  assessments: Assessment[]
  /** `{ sum, valid }` for the course's weights. */
  weights: { sum: number, valid: boolean }
  rows: GradebookStudentRow[]
  /** Per-assessment class statistics, for the teacher's sanity check. */
  statistics: Array<{ assessmentId: number, average: number | null, highest: number | null, lowest: number | null, marked: number }>
  canEdit: boolean
  submission: Submission | null
  passMark: number
}

// ========================================================== attendance =====

export interface AttendanceRecord {
  id: number
  courseId: number
  courseName: string | null
  studentId: number
  studentName: string
  rollId: string
  className: string | null
  date: string
  periodId: number | null
  periodName: string | null
  status: string
  minutesLate: number | null
  note: string | null
  recordedBy: number | null
  recorderName: string | null
  submissionId: number | null
}

export interface AttendanceSheet {
  course: Course
  date: string
  periodId: number | null
  canEdit: boolean
  submission: Submission | null
  rows: Array<{
    studentId: number
    studentName: string
    rollId: string
    recordId: number | null
    status: string
    minutesLate: number | null
    note: string | null
  }>
  /** Per-student totals for the whole course, shown next to the sheet. */
  summary: Array<{ studentId: number, stats: AttendanceStats }>
}

export interface AttendanceStats {
  total: number
  present: number
  late: number
  absent: number
  leave: number
  excused: number
  attended: number
  counted: number
  rate: number | null
  minutesLate: number
  sessions: number
}

export interface AttendanceReport {
  students: Array<{ student: Student, stats: AttendanceStats }>
  overall: AttendanceStats
  dates: string[]
  course: Course | null
  from: string | null
  to: string | null
}

// ============================================================ report ======

export interface ReportCardRow {
  courseId: number
  courseName: string
  subjectName: string | null
  credits: number
  teachers: string[]
  total: number | null
  letter: string | null
  coverage: number
  /** Per-assessment detail, so the card can print the breakdown. */
  assessments: Array<{ id: number, name: string, kind: string, weight: number, maxScore: number, score: number | null }>
}

export interface ReportCard {
  student: Student
  semester: Semester | null
  rows: ReportCardRow[]
  summary: {
    average: number | null
    courses: number
    passed: number
    failed: number
    best: { courseId: number, total: number } | null
    worst: { courseId: number, total: number } | null
    merits: number
    demerits: number
  }
  /** Rank inside the student's class, over the same term. */
  rank: { position: number | null, of: number, classAverage: number | null }
  conduct: ConductRecord[]
  attendance: AttendanceStats
  passMark: number
  generatedAt: string
}

// ============================================================ conduct ======

export interface ConductCategory {
  id: number
  name: string
  kind: 'merit' | 'demerit' | string
  description: string | null
  sortOrder: number
  ruleCount: number
}

export interface ConductRule {
  id: number
  categoryId: number | null
  categoryName: string | null
  categoryKind: string | null
  name: string
  description: string | null
  points: number
  sortOrder: number
}

export interface ConductRecord {
  id: number
  studentId: number
  studentName: string
  rollId: string
  className: string | null
  ruleId: number | null
  ruleName: string | null
  kind: 'merit' | 'demerit' | string
  points: number
  courseId: number | null
  courseName: string | null
  semesterId: number | null
  date: string
  description: string | null
  recordedBy: number | null
  recorderName: string | null
  submissionId: number | null
}

// =========================================================== workflow =====

export interface Submission {
  id: number
  kind: 'scores' | 'attendance' | 'conduct' | string
  title: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | string
  courseId: number | null
  courseName: string | null
  className: string | null
  semesterId: number | null
  semesterName: string | null
  submittedBy: number | null
  submitterName: string | null
  submittedAt: string | null
  reviewedBy: number | null
  reviewerName: string | null
  reviewedAt: string | null
  reviewNote: string | null
  recordCount: number
}

// ============================================================ content ======

export interface Notice {
  id: number
  title: string
  body: string | null
  audience: 'all' | 'teachers' | 'students' | 'guardians' | string
  isPinned: boolean
  publishedAt: string | null
  expiresAt: string | null
  authorName: string | null
}

export interface Article {
  id: number
  title: string
  slug: string
  summary: string | null
  body: string | null
  cover: string | null
  publishedAt: string | null
  readCount: number
  authorName: string | null
}

export interface Activity {
  id: number
  name: string
  description: string | null
  location: string | null
  startAt: string | null
  endAt: string | null
  semesterId: number | null
  semesterName: string | null
  cover: string | null
  publishedAt: string | null
}

export interface Feedback {
  id: number
  userId: number | null
  userName: string | null
  kind: 'bug' | 'suggestion' | 'other' | string
  title: string
  body: string | null
  status: 'open' | 'in_progress' | 'closed' | string
  handledBy: number | null
  handledAt: string | null
  reply: string | null
  createdAt: string | null
}

// ============================================================= viewer =====

export interface SmsViewer {
  signedIn: boolean
  admin: boolean
  /** `admin` | `teacher` | `student` | `guardian` | `anonymous` */
  role: 'admin' | 'teacher' | 'student' | 'guardian' | 'anonymous'
  userId: number | null
  name: string | null
  teacherId: number | null
  studentId: number | null
  classId: number | null
  guardianIds: number[]
  wardIds: number[]
  isStaff: boolean
  /** Whether the viewer is linked to a teacher/student/guardian record at all. */
  linked: boolean
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface SchoolHome {
  viewer: SmsViewer
  schoolName: string
  stats: { students: number, teachers: number, classes: number, courses: number }
  notices: Notice[]
  articles: Article[]
  activities: Activity[]
  semester: Semester | null
}

export interface PortalSummary {
  viewer: SmsViewer
  schoolName: string
  semester: Semester | null
  /** Only the blocks that apply to this role are populated. */
  teacher: {
    courses: Course[]
    classes: SchoolClass[]
    pendingSubmissions: number
    todayLessons: TimetableEntry[]
  } | null
  student: {
    profile: Student | null
    courses: Course[]
    todayLessons: TimetableEntry[]
    average: number | null
    attendance: AttendanceStats
    recentConduct: ConductRecord[]
    pendingHomework: Assessment[]
  } | null
  guardian: {
    children: Array<{ student: Student, average: number | null, attendance: AttendanceStats, demerits: number, merits: number }>
  } | null
  admin: {
    pendingSubmissions: number
    counts: { students: number, teachers: number, guardians: number, courses: number, classes: number }
  } | null
  notices: Notice[]
}

// ------------------------------------------------------------ formatting ----

/** `2024-09-01` → `1 Sep 2024`. Dates are calendar dates, so this is timezone-free. */
export function formatDate(value: string | null | undefined, locale?: string): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return '—'
  const [, year, month, day] = match
  // Built in UTC and formatted in UTC, so the day never shifts.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (Number.isNaN(date.getTime())) return '—'
  // Round-trip check rejects 2024-13-01 / 2024-02-31, which `Date` happily rolls
  // over into a different month — the same guard the server's `dateParam` uses.
  if (date.toISOString().slice(0, 10) !== value) return '—'
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

/** A real instant, shown in the viewer's timezone. */
export function formatDateTime(value: string | null | undefined, locale?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatTime(value: string | null | undefined): string {
  return value || '—'
}

/** `0.9134` → `91.3%`. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/** A mark out of 100, or the em dash when nothing has been marked. */
export function formatMark(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 100) / 100)
}

/** Today as `YYYY-MM-DD`, for the default date of an attendance sheet. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** `birthday` → age in years, or null when there is no date to work from. */
export function ageFrom(birthday: string | null | undefined): number | null {
  if (!birthday) return null
  const born = new Date(`${birthday}T00:00:00Z`)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const beforeBirthday = now.getUTCMonth() < born.getUTCMonth()
    || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())
  if (beforeBirthday) age--
  return age >= 0 ? age : null
}

/**
 * The floor a mark has to reach to pass, as a fraction.
 * Exposed so a UI can colour a mark without knowing the school's settings.
 */
export function passesMark(mark: number | null | undefined, passMark: number): boolean {
  return mark != null && Number.isFinite(mark) && mark >= passMark
}

/**
 * The i18n key for a guardian's relationship.
 *
 * The stored value is `father` / `mother` / `guardian`, but the label key for the
 * last one is `guardianRelation` (because `guardian` is already the name of the
 * person), so callers must map through here rather than interpolating the raw
 * value into `sms.guardians.${relation}`.
 */
export function relationKey(relation: string | null | undefined): string {
  if (relation === 'father' || relation === 'mother') return relation
  if (relation === 'guardian') return 'guardianRelation'
  return 'relation'
}

// --------------------------------------------------------------- fetchers ---

export function fetchSchoolHome(): Promise<SchoolHome> {
  return cGet<SchoolHome>('/api/sms/home')
}

export function fetchPortal(): Promise<PortalSummary> {
  return cGet<PortalSummary>('/api/sms/portal')
}

export function fetchViewer(): Promise<{ viewer: SmsViewer }> {
  return cGet<{ viewer: SmsViewer }>('/api/sms/me')
}

export function fetchNotices(query: Record<string, unknown> = {}): Promise<Paginated<Notice>> {
  return cGet<Paginated<Notice>>('/api/sms/notices', query)
}

export function fetchArticles(query: Record<string, unknown> = {}): Promise<Paginated<Article>> {
  return cGet<Paginated<Article>>('/api/sms/articles', query)
}

export function fetchActivities(query: Record<string, unknown> = {}): Promise<Paginated<Activity>> {
  return cGet<Paginated<Activity>>('/api/sms/activities', query)
}

export function fetchTimetable(query: Record<string, unknown> = {}): Promise<TimetableResponse> {
  return cGet<TimetableResponse>('/api/sms/timetable', query)
}

export function fetchCourses(query: Record<string, unknown> = {}): Promise<Paginated<Course>> {
  return cGet<Paginated<Course>>('/api/sms/courses', query)
}

/** A course's whole overview: the course, its marking scheme, roster and week. */
export interface CourseDetail {
  course: Course
  assessments: Assessment[]
  students: Student[]
  lessons: TimetableEntry[]
  weights: { sum: number, valid: boolean }
}

export function fetchCourse(id: number): Promise<CourseDetail> {
  return cGet<CourseDetail>(`/api/sms/courses/${id}`)
}

export function fetchClasses(query: Record<string, unknown> = {}): Promise<Paginated<SchoolClass>> {
  return cGet<Paginated<SchoolClass>>('/api/sms/classes', query)
}

export function fetchStudents(query: Record<string, unknown> = {}): Promise<Paginated<Student>> {
  return cGet<Paginated<Student>>('/api/sms/students', query)
}

export function fetchTeachers(query: Record<string, unknown> = {}): Promise<Paginated<Teacher>> {
  return cGet<Paginated<Teacher>>('/api/sms/teachers', query)
}

export function fetchGuardians(query: Record<string, unknown> = {}): Promise<Paginated<Guardian>> {
  return cGet<Paginated<Guardian>>('/api/sms/guardians', query)
}

export function fetchGradebook(courseId: number): Promise<Gradebook> {
  return cGet<Gradebook>(`/api/sms/courses/${courseId}/gradebook`)
}

export function fetchAttendanceSheet(courseId: number, query: Record<string, unknown> = {}): Promise<AttendanceSheet> {
  return cGet<AttendanceSheet>(`/api/sms/courses/${courseId}/attendance`, query)
}

export function fetchReportCard(studentId: number, query: Record<string, unknown> = {}): Promise<ReportCard> {
  return cGet<ReportCard>(`/api/sms/students/${studentId}/report-card`, query)
}

export function fetchConduct(query: Record<string, unknown> = {}): Promise<Paginated<ConductRecord>> {
  return cGet<Paginated<ConductRecord>>('/api/sms/conduct/records', query)
}

export function fetchSubmissions(query: Record<string, unknown> = {}): Promise<Paginated<Submission>> {
  return cGet<Paginated<Submission>>('/api/sms/submissions', query)
}

export function fetchFeedback(query: Record<string, unknown> = {}): Promise<Paginated<Feedback>> {
  return cGet<Paginated<Feedback>>('/api/sms/feedback', query)
}

// ------------------------------------------------------------ reference ----

/** The school's settings, as `/api/sms/config` returns them. */
export interface SmsSettings {
  schoolName: string
  passMark: number
  currentSemesterId: number | null
}

/** The small lookup tables every picker and filter bar reads. */
export interface SmsReference {
  departments: Department[]
  grades: Grade[]
  subjects: Subject[]
  semesters: Semester[]
  classrooms: Classroom[]
  periods: Period[]
}

export interface ClassDetail {
  class: SchoolClass
  students: Student[]
  courses: Course[]
}

export interface StudentProfile {
  student: Student
  guardians: Guardian[]
  conduct: ConductRecord[]
  attendance: AttendanceStats
}

export function fetchReference(): Promise<SmsReference> {
  return cGet<SmsReference>('/api/sms/reference')
}

export function fetchClassDetail(id: number): Promise<ClassDetail> {
  return cGet<ClassDetail>(`/api/sms/classes/${id}`)
}

export function fetchStudent(id: number): Promise<StudentProfile> {
  return cGet<StudentProfile>(`/api/sms/students/${id}`)
}

export function fetchArticle(slug: string): Promise<{ article: Article }> {
  return cGet<{ article: Article }>(`/api/sms/articles/${slug}`)
}

export function fetchConductCategories(): Promise<{ items: ConductCategory[] }> {
  return cGet<{ items: ConductCategory[] }>('/api/sms/conduct/categories')
}

export function fetchConductRules(query: Record<string, unknown> = {}): Promise<{ items: ConductRule[] }> {
  return cGet<{ items: ConductRule[] }>('/api/sms/conduct/rules', query)
}

export function fetchAttendanceReport(query: Record<string, unknown> = {}): Promise<AttendanceReport> {
  return cGet<AttendanceReport>('/api/sms/attendance/summary', query)
}
