<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })
useHead({ title: 'SMS 班级管理' })
</script>

<template>
  <SmsCrudPage table="classes" />
</template>
