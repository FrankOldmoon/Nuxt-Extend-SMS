<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

const route = useRoute()
const conversationId = computed(() => {
  const id = Number(route.params.id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
})
</script>

<template>
  <SmsChatView :conversation-id="conversationId" />
</template>
