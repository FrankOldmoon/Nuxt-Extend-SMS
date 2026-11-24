<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })
const route = useRoute()
const table = computed(() => String(route.params.table ?? ''))
// Only SMS resources belong in this workbench; access is still checked by the host API.
const tables = new Set(['students', 'classes', 'enrollments', 'teachers', 'guardians', 'studentGuardians', 'academicYears', 'terms', 'grades', 'subjects'])
useHead({ title: 'SMS 基础管理' })
</script>

<template>
  <SmsCrudPage
    v-if="tables.has(table)"
    :key="table"
    :table="table"
  />
  <div
    v-else
    class="p-5"
  >
    <UAlert
      color="warning"
      title="找不到此学校管理页面"
    />
  </div>
</template>
