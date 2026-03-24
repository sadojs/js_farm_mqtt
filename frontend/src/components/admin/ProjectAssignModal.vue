<template>
  <div v-if="show" class="modal-overlay" @click.self="closeModal">
    <div class="modal-container">
      <div class="modal-header">
        <h2>센서 프로젝트 할당</h2>
        <button class="close-btn" @click="closeModal">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="user" class="user-info">
          <div class="user-avatar">{{ user.name.charAt(0) }}</div>
          <div>
            <h3>{{ user.name }}</h3>
            <p>{{ user.email }}</p>
          </div>
        </div>

        <div class="projects-list">
          <h4>사용 가능한 센서 프로젝트</h4>
          <div
            v-for="project in availableProjects"
            :key="project.id"
            class="project-item"
            :class="{ selected: selectedProject === project.id }"
            @click="selectedProject = project.id"
          >
            <input
              type="radio"
              :value="project.id"
              v-model="selectedProject"
              @click.stop
            />
            <div class="project-icon">📦</div>
            <div class="project-info">
              <h5>{{ project.name }}</h5>
              <p>{{ project.description }}</p>
              <div class="project-meta">
                <span>{{ project.deviceCount }}개 장비</span>
                <span>·</span>
                <span>{{ project.region }}</span>
              </div>
            </div>
            <span v-if="project.assigned" class="assigned-badge">
              할당됨
            </span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="closeModal">취소</button>
        <button
          class="btn-primary"
          :disabled="!selectedProject"
          @click="handleAssign"
        >
          할당
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface ProjectUser {
  id?: string
  name: string
  email: string
  [key: string]: any
}

interface TuyaProject {
  id: string
  name: string
  description: string
  deviceCount: number
  region: string
  assigned: boolean
}

const props = defineProps<{
  show: boolean
  user: ProjectUser | null
}>()

const emit = defineEmits<{
  close: []
  assign: [projectId: string]
}>()

const availableProjects = ref<TuyaProject[]>([
  {
    id: 'project-001',
    name: 'Project 001 - 1농장',
    description: '경기도 화성시 소재 스마트팜',
    deviceCount: 24,
    region: '경기도 화성시',
    assigned: true
  },
  {
    id: 'project-002',
    name: 'Project 002 - 2농장',
    description: '충청남도 천안시 소재 스마트팜',
    deviceCount: 18,
    region: '충청남도 천안시',
    assigned: true
  },
  {
    id: 'project-003',
    name: 'Project 003 - 3농장',
    description: '전라남도 나주시 소재 스마트팜',
    deviceCount: 30,
    region: '전라남도 나주시',
    assigned: false
  },
  {
    id: 'project-004',
    name: 'Project 004 - 육묘장',
    description: '경기도 평택시 육묘장',
    deviceCount: 12,
    region: '경기도 평택시',
    assigned: false
  }
])

const selectedProject = ref<string>(props.user?.tuyaProject || '')

const handleAssign = () => {
  if (selectedProject.value) {
    emit('assign', selectedProject.value)
  }
}

const closeModal = () => {
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
  border: 1px solid var(--border-color);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid var(--border-input);
}

.modal-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 12px;
  margin-bottom: 24px;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 18px;
  flex-shrink: 0;
}

.user-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}

.user-info p {
  font-size: 14px;
  color: var(--text-link);
  margin: 0;
}

.projects-list h4 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px 0;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 2px solid var(--border-input);
  border-radius: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.project-item:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.project-item.selected {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.project-item input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.project-icon {
  font-size: 32px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  flex-shrink: 0;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-info h5 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}

.project-info p {
  font-size: 13px;
  color: var(--text-link);
  margin: 0 0 8px 0;
}

.project-meta {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.assigned-badge {
  padding: 4px 12px;
  background: var(--automation-bg);
  color: var(--automation-text);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-input);
}

.btn-primary,
.btn-secondary {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

.btn-primary:disabled {
  background: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

@media (max-width: 768px) {
  .modal-container {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
}
</style>
