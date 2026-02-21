import { Context, Schema } from 'koishi'

export const name = 'group-verification'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config) {
  // write your plugin here
}
