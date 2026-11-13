<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

await navigateTo('/sms/chat', { replace: true, redirectCode: 302 })
</script>

<template>
  <div />
</template>
