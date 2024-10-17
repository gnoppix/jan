import path from 'path'
import { log, SystemInformation } from '@janhq/core/node'
import { executableCortexFile } from './execute'
import { ProcessWatchdog } from './watchdog'

// The HOST address to use for the Nitro subprocess
const LOCAL_PORT = '39291'
let watchdog: ProcessWatchdog | undefined = undefined

/**
 * Spawns a Nitro subprocess.
 * @returns A promise that resolves when the Nitro subprocess is started.
 */
function run(systemInfo?: SystemInformation): Promise<any> {
  log(`[CORTEX]:: Spawning cortex subprocess...`)

  return new Promise<void>(async (resolve, reject) => {
    let executableOptions = executableCortexFile(
      // If ngl is not set or equal to 0, run on CPU with correct instructions
      systemInfo?.gpuSetting
        ? {
            ...systemInfo.gpuSetting,
            run_mode: systemInfo.gpuSetting.run_mode,
          }
        : undefined
    )

    // Execute the binary
    log(`[CORTEX]:: Spawn cortex at path: ${executableOptions.executablePath}`)
    log(`[CORTEX]::Debug: Cortex engine path: ${executableOptions.enginePath}`)

    // Add engine path to the PATH and LD_LIBRARY_PATH
    process.env.PATH = (process.env.PATH || '').concat(
      path.delimiter,
      executableOptions.enginePath
    )
    log(`[CORTEX] PATH: ${process.env.PATH}`)
    process.env.LD_LIBRARY_PATH = (process.env.LD_LIBRARY_PATH || '').concat(
      path.delimiter,
      executableOptions.enginePath
    )

    watchdog = new ProcessWatchdog(
      executableOptions.executablePath,
      ['--start-server', '--port', LOCAL_PORT.toString()],
      {
        cwd: executableOptions.enginePath,
        env: {
          ...process.env,
          ENGINE_PATH: executableOptions.enginePath,
          CUDA_VISIBLE_DEVICES: executableOptions.cudaVisibleDevices,
          // Vulkan - Support 1 device at a time for now
          ...(executableOptions.vkVisibleDevices?.length > 0 && {
            GGML_VULKAN_DEVICE: executableOptions.vkVisibleDevices[0],
          }),
        },
      }
    )
    watchdog.start()
    resolve()
  })
}

/**
 * Every module should have a dispose function
 * This will be called when the extension is unloaded and should clean up any resources
 * Also called when app is closed
 */
function dispose() {
  watchdog?.terminate()
}

/**
 * Cortex process info
 */
export interface CortexProcessInfo {
  isRunning: boolean
}

export default {
  run,
  dispose,
}
