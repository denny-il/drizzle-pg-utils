import type { ColumnBaseConfig, ColumnDataType } from 'drizzle-orm'
import type {
  CheckBuilder,
  customType,
  ExtraConfigColumn,
} from 'drizzle-orm/pg-core'

export type TemporalColumn<
  T extends {
    config: {
      data: any
      driverData: string
      config?: any
    }
    constraits: boolean
  },
> = {
  column: ReturnType<
    typeof customType<{
      data: T['config']['data']
      driverData: T['config']['driverData']
      config?: T['config']['config']
    }>
  >
} & (T['constraits'] extends true
  ? {
      constraints: (
        config: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>,
        name?: string,
      ) => CheckBuilder[]
    }
  : {})
