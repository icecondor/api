import { Access } from '../../protobuf/ts/access'
import { Config } from '../../protobuf/ts/config'
import { Device } from '../../protobuf/ts/device'
import { Friendship } from '../../protobuf/ts/friendship'
import { Heartbeat } from '../../protobuf/ts/heartbeat'
import { Location as LocationTs } from '../../protobuf/ts/location'
import { User } from '../../protobuf/ts/user'

interface Index {
  type: string
}

export interface Location extends Index, LocationTs {}

export { Access, Config, Device, Friendship, Heartbeat, User }
