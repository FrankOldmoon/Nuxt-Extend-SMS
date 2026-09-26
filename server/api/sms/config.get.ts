/**
 * School — the settings handshake.
 *
 * The public pages need the school's name for the header, the pass mark for
 * colouring marks, and the current semester so a picker can default to the term
 * the school is actually in. None of these are secrets, so this endpoint is
 * readable anonymously on purpose and must never call `assertSignedIn` — the home
 * page loads it before the viewer is known.
 */
import { getCurrentSemesterId, getSchoolSettings } from '../../utils/access'

export default defineEventHandler(async () => {
  const [school, currentSemesterId] = await Promise.all([
    getSchoolSettings(),
    getCurrentSemesterId()
  ])

  return {
    schoolName: school.schoolName,
    passMark: school.passMark,
    currentSemesterId
  }
})
