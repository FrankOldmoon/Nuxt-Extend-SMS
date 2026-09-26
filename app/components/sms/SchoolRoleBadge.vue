<script setup lang="ts">
/**
 * The badge that answers "which role am I seeing the school through".
 *
 * A teacher and a student open the same URL and get different pages, so the role
 * is not decoration: it is the explanation for every permission the page then
 * applies. The colour/icon pair is stated once here rather than at each call
 * site, so the same role never appears two different ways.
 */
const props = defineProps<{ role: string }>()
const { t } = useI18n()

const meta = computed(() => {
  switch (props.role) {
    case 'admin':
      return { icon: 'i-lucide-shield-check', color: 'primary' as const }
    case 'teacher':
      return { icon: 'i-lucide-user-check', color: 'info' as const }
    case 'student':
      return { icon: 'i-lucide-graduation-cap', color: 'success' as const }
    case 'guardian':
      return { icon: 'i-lucide-user-round', color: 'warning' as const }
    default:
      return { icon: 'i-lucide-user', color: 'neutral' as const }
  }
})
</script>

<template>
  <UBadge
    :color="meta.color"
    variant="subtle"
    :icon="meta.icon"
    :label="t(`sms.role.${props.role}`)"
  />
</template>
