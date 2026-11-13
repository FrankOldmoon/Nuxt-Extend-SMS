<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

const route = useRoute()
const prompt = computed(() => {
  const value = route.query.prompt
  return typeof value === 'string' ? value : ''
})
</script>

<template>
  <SmsChatView :initial-prompt="prompt" />
</template>
