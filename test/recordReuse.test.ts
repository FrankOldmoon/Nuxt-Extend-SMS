// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import { mount } from '@vue/test-utils'
import RecordDialog from '../app/components/sms/RecordDialog.vue'
import { validateForm } from '../../../app/composables/useFormValidation'

beforeEach(() => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('validateForm', validateForm)
})
afterEach(() => vi.unstubAllGlobals())

describe('SMS dialog with shared form', () => {
  function dialog() {
    return mount(RecordDialog, {
      props: {
        open: true, title: '学生', canEdit: true,
        record: { name: '测试', classId: 2, score: 88, userId: 123456 },
        fields: [
          { key: 'name', label: '姓名', required: true },
          { key: 'classId', label: '班级', type: 'select', options: [{ label: '未分班', value: null }, { label: '1A', value: 2 }] },
          { key: 'score', label: '成绩', type: 'number' },
          { key: 'userId', label: '用户', editable: false, mask: true }
        ]
      },
      global: { stubs: {
        UModal: { template: '<div><slot name="body" /></div>' },
        UButton: { template: '<button><slot /></button>' },
        UIcon: true,
        DashboardCrudForm: { name: 'DashboardCrudForm', props: ['modelValue', 'meta', 'errors'], template: '<div />' },
        DashboardCrudDetail: { props: ['meta'], template: '<div><slot v-for="f in meta.fields" :name="`detail-${f.key}`" /></div>' }
      } }
    })
  }

  it('preserves masking, typed selection and excludes protected fields on save', async () => {
    const wrapper = dialog()
    expect(wrapper.text()).toContain('••••56')
    expect(wrapper.text()).not.toContain('123456')
    await wrapper.findAll('button').find(b => b.text() === '编辑')!.trigger('click')
    const form = wrapper.findComponent({ name: 'DashboardCrudForm' })
    form.vm.$emit('update:modelValue', { name: '新姓名', classId: 2, score: 90, userId: 999 })
    await wrapper.findAll('button').find(b => b.text() === '保存')!.trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({ name: '新姓名', classId: 2, score: 90 })
    wrapper.unmount()
  })

  it('blocks a blank required name through shared validation', async () => {
    const wrapper = dialog()
    await wrapper.findAll('button').find(b => b.text() === '编辑')!.trigger('click')
    const form = wrapper.findComponent({ name: 'DashboardCrudForm' })
    form.vm.$emit('update:modelValue', { name: '', classId: null })
    await wrapper.findAll('button').find(b => b.text() === '保存')!.trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(form.props('errors')).toHaveProperty('name')
    wrapper.unmount()
  })
})
