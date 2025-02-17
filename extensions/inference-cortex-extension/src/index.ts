/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  Model,
  executeOnMain,
  systemInformation,
  joinPath,
  LocalOAIEngine,
  InferenceEngine,
  getJanDataFolderPath,
  extractModelLoadParams,
  fs,
} from '@janhq/core'
import PQueue from 'p-queue'
import ky from 'ky'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  // DEPRECATED
  nodeModule: string = 'node'

  queue = new PQueue({ concurrency: 1 })

  provider: string = InferenceEngine.cortex

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = `${CORTEX_API_URL}/v1/chat/completions`

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    const models = MODELS as Model[]

    this.registerModels(models)

    super.onLoad()

    // Run the process watchdog
    const systemInfo = await systemInformation()
    await this.clean()
    await executeOnMain(NODE, 'run', systemInfo)

    this.queue.add(() => this.healthz())

    window.addEventListener('beforeunload', () => {
      this.clean()
    })
  }

  onUnload(): void {
    this.clean()
    executeOnMain(NODE, 'dispose')
    super.onUnload()
  }

  override async loadModel(
    model: Model & { file_path?: string }
  ): Promise<void> {
    if (
      model.engine === InferenceEngine.nitro &&
      model.settings.llama_model_path
    ) {
      // Legacy chat model support
      model.settings = {
        ...model.settings,
        llama_model_path: await getModelFilePath(
          model,
          model.settings.llama_model_path
        ),
      }
    } else {
      const { llama_model_path, ...settings } = model.settings
      model.settings = settings
    }

    if (model.engine === InferenceEngine.nitro && model.settings.mmproj) {
      // Legacy clip vision model support
      model.settings = {
        ...model.settings,
        mmproj: await getModelFilePath(model, model.settings.mmproj),
      }
    } else {
      const { mmproj, ...settings } = model.settings
      model.settings = settings
    }

    return await this.queue.add(() =>
      ky
        .post(`${CORTEX_API_URL}/v1/models/start`, {
          json: {
            ...extractModelLoadParams(model.settings),
            model: model.id,
            engine:
              model.engine === InferenceEngine.nitro // Legacy model cache
                ? InferenceEngine.cortex_llamacpp
                : model.engine,
          },
        })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .then()
    )
  }

  override async unloadModel(model: Model): Promise<void> {
    return ky
      .post(`${CORTEX_API_URL}/v1/models/stop`, {
        json: { model: model.id },
      })
      .json()
      .then()
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  healthz(): Promise<void> {
    return ky
      .get(`${CORTEX_API_URL}/healthz`, {
        retry: {
          limit: 10,
          methods: ['get'],
        },
      })
      .then(() => {})
  }

  /**
   * Clean cortex processes
   * @returns
   */
  clean(): Promise<any> {
    return ky
      .delete(`${CORTEX_API_URL}/processmanager/destroy`, {
        timeout: 2000, // maximum 2 seconds
      })
      .catch(() => {
        // Do nothing
      })
  }
}

/// Legacy
export const getModelFilePath = async (
  model: Model,
  file: string
): Promise<string> => {
  // Symlink to the model file
  if (
    !model.sources[0]?.url.startsWith('http') &&
    (await fs.existsSync(model.sources[0].url))
  ) {
    return model.sources[0]?.url
  }
  return joinPath([await getJanDataFolderPath(), 'models', model.id, file])
}
///
