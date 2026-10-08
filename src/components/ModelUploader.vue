<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  modelUrl: string
  thumbnailUrl?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelUrl', v: string): void
  (e: 'update:thumbnailUrl', v: string | undefined): void
}>()

const modelInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const notice = ref('')
const error = ref('')

const modelLabel = computed(() => props.modelUrl || '未配置，使用内置模型')

function pickModel() {
  modelInput.value?.click()
}

function pickImage() {
  imageInput.value?.click()
}

function onModelFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  const lower = file.name.toLowerCase()
  if (!/\.(glb|gltf)$/.test(lower)) {
    error.value = '只支持 .glb / .gltf 模型文件'
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    error.value = '模型文件超过 40MB，加载会非常慢，建议压缩后再用'
    return
  }
  // 本地文件只在当前会话有效：刷新后浏览器会回收 blob 地址
  const url = URL.createObjectURL(file)
  emit('update:modelUrl', url)
  notice.value = `已载入本地模型「${file.name}」，仅当前会话有效；刷新后请改用可访问的网络地址。`
}

function onImageFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '缩略图需要是图片文件'
    return
  }
  if (file.size > 600 * 1024) {
    error.value = '缩略图请控制在 600KB 以内（会存进浏览器本地存储）'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    emit('update:thumbnailUrl', String(reader.result))
    notice.value = '缩略图已更新'
  }
  reader.onerror = () => {
    error.value = '缩略图读取失败'
  }
  reader.readAsDataURL(file)
}

function clearModel() {
  emit('update:modelUrl', '')
  notice.value = '已改为使用内置模型'
}
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="mb-1.5 block text-[12px] font-medium text-slate-700">3D 模型（.glb / .gltf）</label>
      <div class="flex gap-2">
        <input
          :value="modelUrl"
          type="text"
          placeholder="/models/bear.glb 或 https://…/bear.glb"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
          @input="emit('update:modelUrl', ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="flex-none rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50"
          @click="pickModel"
        >
          本地文件
        </button>
      </div>
      <p class="mt-1.5 truncate text-[11px] text-slate-400" :title="modelLabel">{{ modelLabel }}</p>
      <input
        ref="modelInput"
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        class="hidden"
        @change="onModelFile"
      />
      <button
        v-if="modelUrl"
        type="button"
        class="mt-1 text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
        @click="clearModel"
      >
        清除自定义模型
      </button>
    </div>

    <div>
      <label class="mb-1.5 block text-[12px] font-medium text-slate-700">物品缩略图</label>
      <div class="flex items-center gap-3">
        <div
          class="flex h-14 w-12 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
        >
          <img v-if="thumbnailUrl" :src="thumbnailUrl" class="h-full w-full object-contain" alt="" />
          <span v-else class="text-[10px] text-slate-400">自动</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50"
            @click="pickImage"
          >
            上传缩略图
          </button>
          <button
            v-if="thumbnailUrl"
            type="button"
            class="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
            @click="emit('update:thumbnailUrl', undefined)"
          >
            使用系统缩略图
          </button>
        </div>
        <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="onImageFile" />
      </div>
    </div>

    <p v-if="notice" class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-700">
      {{ notice }}
    </p>
    <p v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
      {{ error }}
    </p>

    <p class="text-[11px] leading-relaxed text-slate-400">
      未配置模型时会使用系统内置模型；模型加载失败也不会影响其它物品，会自动降级为占位模型。
    </p>
  </div>
</template>
