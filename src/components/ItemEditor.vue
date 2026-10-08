<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ClawMachineItem, GrabDifficulty, PositionMode } from '@/types/claw-machine'
import { M } from '@/three/constants'
import { MAX_QUANTITY } from '@/utils/storage'
import { itemThumbnail } from '@/utils/thumbnail'
import ModelUploader from './ModelUploader.vue'

const props = defineProps<{
  open: boolean
  /** null 表示新增 */
  item: ClawMachineItem | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', item: ClawMachineItem): void
}>()

type Draft = ClawMachineItem

function blankDraft(): Draft {
  return {
    id: '',
    name: '新物品',
    modelUrl: '',
    thumbnailUrl: undefined,
    quantity: 3,
    scale: 1,
    size: { x: 0.24, y: 0.24, z: 0.24 },
    weight: 0.5,
    friction: 0.75,
    restitution: 0.06,
    difficulty: 'normal',
    positionMode: 'random',
    position: { x: 0, y: M.floorY + 0.3, z: 0 },
    randomRotation: true,
    rotation: { x: 0, y: 0, z: 0 },
    enabled: true,
  }
}

const draft = reactive<Draft>(blankDraft())
const errors = ref<Record<string, string>>({})

const isEdit = computed(() => !!props.item)
const title = computed(() => (isEdit.value ? '编辑物品' : '添加物品'))

function syncDraft() {
  const src: Draft = props.item ? (JSON.parse(JSON.stringify(props.item)) as Draft) : blankDraft()
  Object.assign(draft, src)
  draft.size = src.size ? { ...src.size } : { x: 0.24, y: 0.24, z: 0.24 }
  draft.position = src.position ? { ...src.position } : { x: 0, y: M.floorY + 0.3, z: 0 }
  draft.rotation = src.rotation ? { ...src.rotation } : { x: 0, y: 0, z: 0 }
  errors.value = {}
}

watch(
  () => `${props.open}|${props.item?.id ?? 'new'}|${props.item ? 'edit' : 'add'}`,
  () => {
    if (props.open) syncDraft()
  },
  { immediate: true },
)

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!draft.name.trim()) e.name = '请填写物品名称'
  if (draft.name.trim().length > 20) e.name = '名称请控制在 20 个字符内'
  if (!Number.isFinite(draft.quantity) || draft.quantity < 0) e.quantity = '数量不能为负数'
  if (draft.quantity > MAX_QUANTITY) e.quantity = `单个物品数量上限 ${MAX_QUANTITY}`
  if (!Number.isFinite(draft.scale) || draft.scale <= 0) e.scale = '缩放比例需大于 0'
  if (draft.scale > 12) e.scale = '缩放比例过大（上限 12）'
  const s = draft.size!
  for (const axis of ['x', 'y', 'z'] as const) {
    const v = s[axis]
    if (!Number.isFinite(v) || v <= 0.01) e[`size.${axis}`] = '尺寸需大于 0.01'
    if (v > 3) e[`size.${axis}`] = '尺寸过大（上限 3m）'
  }
  if (!Number.isFinite(draft.weight) || draft.weight <= 0) e.weight = '重量需大于 0'
  if (draft.weight > 20) e.weight = '重量过大（上限 20）'
  if (!Number.isFinite(draft.friction ?? 0.75)) e.friction = '摩擦力需为数字'
  if (!Number.isFinite(draft.restitution ?? 0.06)) e.restitution = '弹性需为数字'
  if (draft.positionMode === 'fixed' && draft.position) {
    const p = draft.position
    if (Math.abs(p.x) > M.halfW + 0.2 || Math.abs(p.z) > M.halfD + 0.2) {
      e.position = '坐标超出娃娃机范围，物品会被自动拉回边缘'
    }
  }
  errors.value = e
  return Object.keys(e).length === 0
}

function submit() {
  if (!validate()) return
  const payload: ClawMachineItem = {
    ...draft,
    id: draft.id,
    name: draft.name.trim(),
    modelUrl: draft.modelUrl.trim(),
    thumbnailUrl: draft.thumbnailUrl || undefined,
    quantity: Math.round(draft.quantity),
    size: { ...draft.size! },
    position: draft.position ? { ...draft.position } : undefined,
    rotation: draft.rotation ? { ...draft.rotation } : undefined,
  }
  emit('save', payload)
}

function close() {
  emit('close')
}

const difficulties: { value: GrabDifficulty; label: string; desc: string }[] = [
  { value: 'easy', label: '简单', desc: '容易夹住' },
  { value: 'normal', label: '普通', desc: '需要对准' },
  { value: 'hard', label: '困难', desc: '常常滑落' },
]

const modes: { value: PositionMode; label: string; desc: string }[] = [
  { value: 'random', label: '随机位置', desc: '开局随机散落堆叠' },
  { value: 'fixed', label: '指定位置', desc: '每次生成在同一坐标' },
]

const preview = computed(() => itemThumbnail({ id: draft.id, name: draft.name, thumbnailUrl: draft.thumbnailUrl }))

/** 统一的数值输入处理：既能接受输入框的值，也能做区间钳制 */
function clampNum(
  field:
    | 'quantity'
    | 'scale'
    | 'weight'
    | 'friction'
    | 'restitution'
    | 'size.x'
    | 'size.y'
    | 'size.z'
    | 'position.x'
    | 'position.y'
    | 'position.z'
    | 'rotation.x'
    | 'rotation.y'
    | 'rotation.z',
  v: number,
  min: number,
  max: number,
) {
  const out = Math.min(max, Math.max(min, Number.isFinite(v) ? v : min))
  if (field.includes('.')) {
    const [group, key] = field.split('.') as ['size' | 'position' | 'rotation', 'x' | 'y' | 'z']
    const target = draft[group]
    if (target) (target as unknown as Record<string, number>)[key] = out
  } else {
    ;(draft as unknown as Record<string, number>)[field] = out
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[2px]" @click="close"></div>
    </Transition>

    <Transition name="drawer">
      <aside
        v-if="open"
        class="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-[-24px_0_60px_-24px_rgba(16,24,40,0.28)]"
        :style="{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }"
      >
        <!-- 头部 -->
        <header class="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
          <div class="flex items-center gap-3">
            <div class="flex h-11 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              <img :src="preview" class="h-9 w-8 object-contain" alt="" />
            </div>
            <div>
              <h2 class="text-[16px] font-semibold text-slate-900">{{ title }}</h2>
              <p class="text-[12px] text-slate-500">
                {{ isEdit ? `正在编辑「${item?.name}」` : '配置一个新的娃娃机物品' }}
              </p>
            </div>
          </div>
          <button
            class="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
            @click="close"
          >
            <svg viewBox="0 0 20 20" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <!-- 表单 -->
        <div class="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <!-- 基础信息 -->
          <section class="mb-6">
            <h3 class="section-title">基础信息</h3>
            <div class="space-y-3.5">
              <div>
                <label class="field-label">物品名称 <span class="text-rose-500">*</span></label>
                <input v-model="draft.name" type="text" maxlength="24" class="input" placeholder="例如：小熊" />
                <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
              </div>

              <ModelUploader
                :model-url="draft.modelUrl"
                :thumbnail-url="draft.thumbnailUrl"
                @update:model-url="draft.modelUrl = $event"
                @update:thumbnail-url="draft.thumbnailUrl = $event"
              />

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="field-label">数量</label>
                  <input
                    :value="draft.quantity"
                    type="number"
                    min="0"
                    :max="MAX_QUANTITY"
                    class="input tabular"
                    @input="clampNum('quantity', ($event.target as HTMLInputElement).valueAsNumber, 0, MAX_QUANTITY)"
                  />
                  <p v-if="errors.quantity" class="field-error">{{ errors.quantity }}</p>
                  <p v-else class="field-hint">0 表示不在机器内生成</p>
                </div>
                <div>
                  <label class="field-label">是否启用</label>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="draft.enabled"
                    class="mt-1 flex h-[38px] w-full items-center justify-between rounded-lg border px-3 text-[13px] transition"
                    :class="
                      draft.enabled
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 bg-slate-50 text-slate-500'
                    "
                    @click="draft.enabled = !draft.enabled"
                  >
                    <span>{{ draft.enabled ? '已启用' : '已停用' }}</span>
                    <span class="relative h-5 w-9 rounded-full transition-colors" :class="draft.enabled ? 'bg-emerald-500' : 'bg-slate-300'">
                      <span
                        class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                        :style="{ left: draft.enabled ? '18px' : '2px' }"
                      ></span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <!-- 模型参数 -->
          <section class="mb-6">
            <h3 class="section-title">模型参数</h3>
            <div class="space-y-3.5">
              <div>
                <label class="field-label">模型缩放比例</label>
                <input
                  :value="draft.scale"
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="12"
                  class="input tabular"
                  @input="clampNum('scale', ($event.target as HTMLInputElement).valueAsNumber, 0.05, 12)"
                />
                <p v-if="errors.scale" class="field-error">{{ errors.scale }}</p>
                <p v-else class="field-hint">会在尺寸换算的基础上再乘一次，用于微调视觉大小</p>
              </div>

              <div>
                <label class="field-label">碰撞尺寸（X / Y / Z，单位米）</label>
                <div class="grid grid-cols-3 gap-2">
                  <input
                    v-for="axis in (['x', 'y', 'z'] as const)"
                    :key="axis"
                    :value="draft.size?.[axis]"
                    type="number"
                    step="0.01"
                    min="0.02"
                    max="3"
                    class="input tabular"
                    :placeholder="axis.toUpperCase()"
                    @input="clampNum(`size.${axis}` as const, ($event.target as HTMLInputElement).valueAsNumber, 0.02, 3)"
                  />
                </div>
                <p v-if="errors['size.x'] || errors['size.y'] || errors['size.z']" class="field-error">
                  尺寸需在 0.02 ~ 3 米之间
                </p>
              </div>
            </div>
          </section>

          <!-- 物理参数 -->
          <section class="mb-6">
            <h3 class="section-title">物理参数</h3>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="field-label">重量 kg</label>
                <input
                  :value="draft.weight"
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="20"
                  class="input tabular"
                  @input="clampNum('weight', ($event.target as HTMLInputElement).valueAsNumber, 0.05, 20)"
                />
                <p v-if="errors.weight" class="field-error">{{ errors.weight }}</p>
              </div>
              <div>
                <label class="field-label">摩擦力</label>
                <input
                  :value="draft.friction ?? 0.75"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1.5"
                  class="input tabular"
                  @input="clampNum('friction', ($event.target as HTMLInputElement).valueAsNumber, 0, 1.5)"
                />
              </div>
              <div>
                <label class="field-label">弹性</label>
                <input
                  :value="draft.restitution ?? 0.06"
                  type="number"
                  step="0.02"
                  min="0"
                  max="1"
                  class="input tabular"
                  @input="clampNum('restitution', ($event.target as HTMLInputElement).valueAsNumber, 0, 1)"
                />
              </div>
            </div>
            <p class="field-hint mt-2">重量与摩擦力会直接影响抓取成功率：越重越滑越难夹住。</p>
          </section>

          <!-- 游戏参数 -->
          <section class="mb-6">
            <h3 class="section-title">游戏参数</h3>
            <label class="field-label">抓取难度</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="d in difficulties"
                :key="d.value"
                type="button"
                class="rounded-xl border px-3 py-2.5 text-left transition"
                :class="
                  draft.difficulty === d.value
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15'
                    : 'border-slate-300 hover:border-slate-400'
                "
                @click="draft.difficulty = d.value"
              >
                <div class="text-[13px] font-semibold text-slate-800">{{ d.label }}</div>
                <div class="mt-0.5 text-[11px] text-slate-500">{{ d.desc }}</div>
              </button>
            </div>
          </section>

          <!-- 初始化方式 -->
          <section class="mb-2">
            <h3 class="section-title">初始化方式</h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="m in modes"
                :key="m.value"
                type="button"
                class="rounded-xl border px-3 py-2.5 text-left transition"
                :class="
                  draft.positionMode === m.value
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15'
                    : 'border-slate-300 hover:border-slate-400'
                "
                @click="draft.positionMode = m.value"
              >
                <div class="text-[13px] font-semibold text-slate-800">{{ m.label }}</div>
                <div class="mt-0.5 text-[11px] text-slate-500">{{ m.desc }}</div>
              </button>
            </div>

            <div v-if="draft.positionMode === 'fixed'" class="mt-3">
              <label class="field-label">初始坐标（机器内部局部坐标）</label>
              <div class="grid grid-cols-3 gap-2">
                <input
                  v-for="axis in (['x', 'y', 'z'] as const)"
                  :key="axis"
                  :value="draft.position?.[axis]"
                  type="number"
                  step="0.05"
                  class="input tabular"
                  :placeholder="axis.toUpperCase()"
                  @input="clampNum(`position.${axis}` as const, ($event.target as HTMLInputElement).valueAsNumber, -3, 3)"
                />
              </div>
              <p v-if="errors.position" class="field-error">{{ errors.position }}</p>
              <p v-else class="field-hint">
                地面高度为 {{ M.floorY.toFixed(2) }}m，建议 Y 取 0.90 ~ 1.40；超出范围会自动拉回机器内部
              </p>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="rounded-xl border px-3 py-2.5 text-left transition"
                :class="
                  draft.randomRotation
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15'
                    : 'border-slate-300 hover:border-slate-400'
                "
                @click="draft.randomRotation = true"
              >
                <div class="text-[13px] font-semibold text-slate-800">随机旋转</div>
                <div class="mt-0.5 text-[11px] text-slate-500">自然翻滚，堆叠更真实</div>
              </button>
              <button
                type="button"
                class="rounded-xl border px-3 py-2.5 text-left transition"
                :class="
                  !draft.randomRotation
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15'
                    : 'border-slate-300 hover:border-slate-400'
                "
                @click="draft.randomRotation = false"
              >
                <div class="text-[13px] font-semibold text-slate-800">固定旋转</div>
                <div class="mt-0.5 text-[11px] text-slate-500">每次都保持同一角度</div>
              </button>
            </div>

            <div v-if="!draft.randomRotation" class="mt-3">
              <label class="field-label">固定旋转（弧度，X / Y / Z）</label>
              <div class="grid grid-cols-3 gap-2">
                <input
                  v-for="axis in (['x', 'y', 'z'] as const)"
                  :key="axis"
                  :value="draft.rotation?.[axis]"
                  type="number"
                  step="0.1"
                  class="input tabular"
                  :placeholder="axis.toUpperCase()"
                  @input="clampNum(`rotation.${axis}` as const, ($event.target as HTMLInputElement).valueAsNumber, -10, 10)"
                />
              </div>
            </div>
          </section>
        </div>

        <!-- 底部 -->
        <footer
          class="flex flex-col-reverse items-stretch gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <p class="hidden text-[11px] text-slate-500 sm:block">
            保存后会写入浏览器本地存储，重新进入游戏立即生效
          </p>
          <div class="flex flex-none gap-2.5">
            <button
              class="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-100 sm:flex-none sm:py-2"
              @click="close"
            >
              取消
            </button>
            <button
              class="flex-1 rounded-lg bg-blue-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:flex-none sm:py-2"
              @click="submit"
            >
              保存
            </button>
          </div>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid #cbd5e1;
  background: #fff;
  padding: 0.5rem 0.75rem;
  font-size: 13px;
  color: #1e293b;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.field-label {
  display: block;
  margin-bottom: 0.375rem;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
}

.field-hint {
  margin-top: 0.3rem;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
}

.field-error {
  margin-top: 0.3rem;
  font-size: 11px;
  color: #e11d48;
}

.section-title {
  margin-bottom: 0.85rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}
</style>
