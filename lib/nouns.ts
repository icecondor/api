import { Access as AccessTs } from '../../serialization/protobuf/ts/access'
import { Config as ConfigTs } from '../../serialization/protobuf/ts/config'
import { Device as DeviceTs } from '../../serialization/protobuf/ts/device'
import { Friendship as FriendshipTs } from '../../serialization/protobuf/ts/friendship'
import { Heartbeat as HeartbeatTs } from '../../serialization/protobuf/ts/heartbeat'
import { Location as LocationTs } from '../../serialization/protobuf/ts/location'
import { User as UserTs } from '../../serialization/protobuf/ts/user'
import { Fence as FenceTs } from '../../serialization/protobuf/ts/fence'
import { Rule as RuleTs } from '../../serialization/protobuf/ts/rule'

interface Index {
  type: string
}

export interface Location extends Index, LocationTs { }
export interface Heartbeat extends Index, HeartbeatTs { }
export interface Config extends Index, ConfigTs { }
export interface Access extends Index, AccessTs { }
export interface Device extends Index, DeviceTs { }
export interface Friendship extends Index, FriendshipTs { }
export interface User extends Index, UserTs { }
export interface Fence extends Index, FenceTs { }
export interface Rule extends Index, RuleTs { }
