import { Access as AccessTs } from '../../protobuf/ts/access'
import { Config as ConfigTs } from '../../protobuf/ts/config'
import { Device as DeviceTs } from '../../protobuf/ts/device'
import { Friendship as FriendshipTs } from '../../protobuf/ts/friendship'
import { Heartbeat as HeartbeatTs } from '../../protobuf/ts/heartbeat'
import { Location as LocationTs } from '../../protobuf/ts/location'
import { User as UserTs} from '../../protobuf/ts/user'

interface Index {
  type: string
}

export interface Location extends Index, LocationTs {}
export interface Heartbeat extends Index, HeartbeatTs {}
export interface Config extends Index, ConfigTs {}
export interface Access extends Index, AccessTs {}
export interface Device extends Index, DeviceTs {}
export interface Friendship extends Index, FriendshipTs {}
export interface User extends Index, UserTs {}
