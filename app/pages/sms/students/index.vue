<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })
useHead({ title: 'SMS 学生管理' })
</script>

<template>
  <SmsCrudPage table="students" />
</template>
