import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { SpaceRole, SpaceMember, ChannelPermissionOverride, Ban, Mute } from "../../types/space";

interface SpaceConfigState {
  roles: Record<string, SpaceRole[]>;                    // spaceId → roles
  members: Record<string, SpaceMember[]>;                // spaceId → members with roles
  overrides: Record<string, ChannelPermissionOverride[]>; // spaceId → overrides
  myPermissions: Record<string, string[]>;               // spaceId → current user's resolved permissions
  bans: Record<string, Ban[]>;                           // spaceId → bans
  mutes: Record<string, Mute[]>;                         // spaceId → mutes
  loading: Record<string, boolean>;
}

const initialState: SpaceConfigState = {
  roles: {},
  members: {},
  overrides: {},
  myPermissions: {},
  bans: {},
  mutes: {},
  loading: {},
};

export const spaceConfigSlice = createSlice({
  name: "spaceConfig",
  initialState,
  reducers: {
    // Roles
    setRoles(state, action: PayloadAction<{ spaceId: string; roles: SpaceRole[] }>) {
      state.roles[action.payload.spaceId] = action.payload.roles;
    },
    addRole(state, action: PayloadAction<{ spaceId: string; role: SpaceRole }>) {
      const roles = state.roles[action.payload.spaceId];
      if (roles) {
        roles.push(action.payload.role);
      } else {
        state.roles[action.payload.spaceId] = [action.payload.role];
      }
    },
    updateRoleInList(state, action: PayloadAction<{ spaceId: string; role: SpaceRole }>) {
      const roles = state.roles[action.payload.spaceId];
      if (!roles) return;
      const idx = roles.findIndex((r) => r.id === action.payload.role.id);
      if (idx >= 0) roles[idx] = action.payload.role;
    },
    removeRole(state, action: PayloadAction<{ spaceId: string; roleId: string }>) {
      const roles = state.roles[action.payload.spaceId];
      if (!roles) return;
      state.roles[action.payload.spaceId] = roles.filter((r) => r.id !== action.payload.roleId);
    },

    // Members
    setMembers(state, action: PayloadAction<{ spaceId: string; members: SpaceMember[] }>) {
      state.members[action.payload.spaceId] = action.payload.members;
    },
    updateMemberRoles(state, action: PayloadAction<{ spaceId: string; pubkey: string; roles: SpaceRole[] }>) {
      const members = state.members[action.payload.spaceId];
      if (!members) return;
      const member = members.find((m) => m.pubkey === action.payload.pubkey);
      if (member) {
        member.roles = action.payload.roles;
      }
    },

    // Overrides
    setOverrides(state, action: PayloadAction<{ spaceId: string; overrides: ChannelPermissionOverride[] }>) {
      state.overrides[action.payload.spaceId] = action.payload.overrides;
    },

    // My permissions
    setMyPermissions(state, action: PayloadAction<{ spaceId: string; permissions: string[] }>) {
      state.myPermissions[action.payload.spaceId] = action.payload.permissions;
    },

    // Bans
    setBans(state, action: PayloadAction<{ spaceId: string; bans: Ban[] }>) {
      state.bans[action.payload.spaceId] = action.payload.bans;
    },
    addBan(state, action: PayloadAction<{ spaceId: string; ban: Ban }>) {
      const bans = state.bans[action.payload.spaceId];
      if (bans) {
        bans.push(action.payload.ban);
      } else {
        state.bans[action.payload.spaceId] = [action.payload.ban];
      }
    },
    removeBan(state, action: PayloadAction<{ spaceId: string; pubkey: string }>) {
      const bans = state.bans[action.payload.spaceId];
      if (!bans) return;
      state.bans[action.payload.spaceId] = bans.filter((b) => b.pubkey !== action.payload.pubkey);
    },

    // Mutes
    setMutes(state, action: PayloadAction<{ spaceId: string; mutes: Mute[] }>) {
      state.mutes[action.payload.spaceId] = action.payload.mutes;
    },
    addMute(state, action: PayloadAction<{ spaceId: string; mute: Mute }>) {
      const mutes = state.mutes[action.payload.spaceId];
      if (mutes) {
        mutes.push(action.payload.mute);
      } else {
        state.mutes[action.payload.spaceId] = [action.payload.mute];
      }
    },
    removeMute(state, action: PayloadAction<{ spaceId: string; muteId: string }>) {
      const mutes = state.mutes[action.payload.spaceId];
      if (!mutes) return;
      state.mutes[action.payload.spaceId] = mutes.filter((m) => m.id !== action.payload.muteId);
    },

    // Loading
    setConfigLoading(state, action: PayloadAction<{ spaceId: string; loading: boolean }>) {
      state.loading[action.payload.spaceId] = action.payload.loading;
    },
  },
});

export const {
  setRoles,
  addRole,
  updateRoleInList,
  removeRole,
  setMembers,
  updateMemberRoles,
  setOverrides,
  setMyPermissions,
  setBans,
  addBan,
  removeBan,
  setMutes,
  addMute,
  removeMute,
  setConfigLoading,
} = spaceConfigSlice.actions;
