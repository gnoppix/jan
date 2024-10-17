import PQueue from 'p-queue'
import ky from 'ky'
import {
  DownloadEvent,
  events,
  Model,
  ModelRuntimeParams,
  ModelSettingParams,
} from '@janhq/core'
/**
 * cortex.cpp Model APIs interface
 */
interface ICortexAPI {
  getModel(model: string): Promise<Model>
  getModels(): Promise<Model[]>
  pullModel(model: string): Promise<void>
  importModel(path: string, modelPath: string): Promise<void>
  deleteModel(model: string): Promise<void>
  updateModel(model: object): Promise<void>
  cancelModelPull(model: string): Promise<void>
}
/**
 * Simple CortexAPI service
 * It could be replaced by cortex client sdk later on
 */
const API_URL = 'http://127.0.0.1:39291'
const SOCKET_URL = 'ws://127.0.0.1:39291'

type ModelList = {
  data: any[]
}

export class CortexAPI implements ICortexAPI {
  queue = new PQueue({ concurrency: 1 })
  socket?: WebSocket = undefined

  constructor() {
    this.queue.add(() => this.healthz())
    this.subscribeToEvents()
  }

  getModel(model: string): Promise<any> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/models/${model}`)
        .json()
        .then((e) => this.transformModel(e))
    )
  }

  getModels(): Promise<Model[]> {
    return this.queue
      .add(() => ky.get(`${API_URL}/models`).json<ModelList>())
      .then((e) =>
        typeof e === 'object' ? e.data.map((e) => this.transformModel(e)) : []
      )
  }

  pullModel(model: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/pull`, { json: { model } })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .then()
    )
  }

  importModel(model: string, modelPath: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/import`, { json: { model, modelPath } })
        .json()
        .catch((e) => console.debug(e)) // Ignore error
        .then()
    )
  }

  deleteModel(model: string): Promise<void> {
    return this.queue.add(() =>
      ky.delete(`${API_URL}/models/${model}`).json().then()
    )
  }

  updateModel(model: object): Promise<void> {
    return this.queue.add(() =>
      ky
        .patch(`${API_URL}/v1/models/${model}`, { json: { model } })
        .json()
        .then()
    )
  }
  cancelModelPull(model: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .delete(`${API_URL}/models/pull`, { json: { taskId: model } })
        .json()
        .then()
    )
  }

  healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: {
          limit: 10,
          methods: ['get'],
        },
      })
      .then(() => {})
  }

  subscribeToEvents() {
    this.queue.add(
      () =>
        new Promise<void>((resolve) => {
          this.socket = new WebSocket(`${SOCKET_URL}/events`)
          console.log('Socket connected')

          this.socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data)
            const transferred = data.task.items.reduce(
              (accumulator, currentValue) =>
                accumulator + currentValue.downloadedBytes,
              0
            )
            const total = data.task.items.reduce(
              (accumulator, currentValue) => accumulator + currentValue.bytes,
              0
            )
            const percent = ((transferred ?? 1) / (total ?? 1)) * 100

            events.emit(data.type, {
              modelId: data.task.id,
              percent: percent,
              size: {
                transferred: transferred,
                total: total,
              },
            })
          })
          resolve()
        })
    )
  }

  private transformModel(model: any) {
    model.parameters = setParameters<ModelRuntimeParams>(model)
    model.settings = setParameters<ModelSettingParams>(model)
    model.metadata = {
      tags: [],
    }
    return model as Model
  }
}

type FilteredParams<T> = {
  [K in keyof T]: T[K]
}

function setParameters<T>(params: T): T {
  const filteredParams: FilteredParams<T> = { ...params }
  return filteredParams
}
