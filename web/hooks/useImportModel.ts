import { useCallback } from 'react'

import {
  ExtensionTypeEnum,
  ImportingModel,
  Model,
  ModelExtension,
  OptionType,
  fs,
} from '@janhq/core'

import { atom, useSetAtom } from 'jotai'

import { v4 as uuidv4 } from 'uuid'

import { snackbar } from '@/containers/Toast'

import { FilePathWithSize } from '@/utils/file'

import { extensionManager } from '@/extension'
import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

export type ImportModelStage =
  | 'NONE'
  | 'SELECTING_MODEL'
  | 'CHOOSE_WHAT_TO_IMPORT'
  | 'MODEL_SELECTED'
  | 'IMPORTING_MODEL'
  | 'EDIT_MODEL_INFO'
  | 'CONFIRM_CANCEL'

const importModelStageAtom = atom<ImportModelStage>('NONE')

export const getImportModelStageAtom = atom((get) => get(importModelStageAtom))

export const setImportModelStageAtom = atom(
  null,
  (_get, set, stage: ImportModelStage) => {
    set(importModelStageAtom, stage)
  }
)

export type ModelUpdate = {
  name: string
  description: string
  tags: string[]
}

const useImportModel = () => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const setImportingModels = useSetAtom(importingModelsAtom)

  const importModels = useCallback(
    (models: ImportingModel[], optionType: OptionType) =>
      localImportModels(models, optionType),
    []
  )

  const updateModelInfo = useCallback(
    async (modelInfo: Partial<Model>) => localUpdateModelInfo(modelInfo),
    []
  )

  const sanitizeFilePaths = useCallback(
    async (filePaths: string[]) => {
      if (!filePaths || filePaths.length === 0) return
      const { unsupportedFiles, supportedFiles } = (await fs.getGgufFiles(
        filePaths
      )) as unknown as {
        unsupportedFiles: FilePathWithSize[]
        supportedFiles: FilePathWithSize[]
      }

      const importingModels: ImportingModel[] = supportedFiles.map(
        ({ path, name, size }: FilePathWithSize) => ({
          importId: uuidv4(),
          modelId: undefined,
          name: name.replace('.gguf', ''),
          description: '',
          path: path,
          tags: [],
          size: size,
          status: 'PREPARING',
          format: 'gguf',
        })
      )
      if (unsupportedFiles.length > 0) {
        snackbar({
          description: `Only files with .gguf extension can be imported.`,
          type: 'error',
        })
      }
      if (importingModels.length === 0) return

      setImportingModels(importingModels)
      setImportModelStage('MODEL_SELECTED')
    },
    [setImportModelStage, setImportingModels]
  )

  return { importModels, updateModelInfo, sanitizeFilePaths }
}

const localImportModels = async (
  models: ImportingModel[],
  optionType: OptionType
): Promise<void> => {
  await models
    .filter((e) => !!e.modelId)
    .map((model) => {
      if (model.modelId)
        extensionManager
          .get<ModelExtension>(ExtensionTypeEnum.Model)
          ?.importModel(model.modelId, model.path)
    })
}

const localUpdateModelInfo = async (
  modelInfo: Partial<Model>
): Promise<Model | undefined> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.updateModel(modelInfo)

export default useImportModel
