import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type ComponentType,
} from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideProps } from "lucide-react-native";

import { Type } from "./Type";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";

// The mobile replacement for desktop context menus (guide 03 §4): long-press
// → bottom action sheet. Generic row list; note/user actions compose it.
// Present via ref: sheetRef.current?.present().
//
// Implementation note: this is intentionally a plain RN Modal, not
// @gorhom/bottom-sheet. Under Expo Go SDK 57 (RN 0.86 new-arch + reanimated
// 4.5) the gorhom modal presents at zero height — present() runs, nothing
// draws. The dep stays installed; swap these internals back when the
// dev-client build lands on a compatible pairing. The ref API already
// matches (present/dismiss).

export interface SheetAction {
  icon: ComponentType<LucideProps>;
  label: string;
  /** Smaller second line (e.g. what blocking does). */
  sublabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export interface ActionsSheetProps {
  title?: string;
  actions: SheetAction[];
}

export interface ActionsSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const ActionsSheet = forwardRef<ActionsSheetRef, ActionsSheetProps>(
  function ActionsSheet({ title, actions }, ref) {
    const { tokens } = useTheme();
    const insets = useSafeAreaInsets();
    const [visible, setVisible] = useState(false);

    const dismiss = useCallback(() => setVisible(false), []);
    useImperativeHandle(ref, () => ({
      present: () => setVisible(true),
      dismiss,
    }));

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={dismiss}
      >
        {/* Backdrop — tap to dismiss */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="flex-1 bg-black/50"
          onPress={dismiss}
        />
        <View
          className="rounded-t-3xl"
          style={{
            backgroundColor: tokens.popover,
            paddingBottom: insets.bottom + 8,
          }}
        >
          {/* Grabber */}
          <View className="items-center pb-1 pt-2.5">
            <View
              className="h-1 w-9 rounded-full"
              style={{ backgroundColor: tokens.border }}
            />
          </View>
          {title ? (
            <View className="items-center px-6 pb-1">
              <Type role="caption" weight={500} style={{ color: tokens.muted }} numberOfLines={1}>
                {title}
              </Type>
            </View>
          ) : null}
          {actions.map((action) => {
            const Icon = action.icon;
            const color = action.destructive ? tokens.destructive : tokens.soft;
            return (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                disabled={action.disabled}
                onPress={() => {
                  haptics.selection();
                  action.onPress();
                }}
                className="min-h-[52px] flex-row items-center gap-4 px-6 py-2 active:opacity-70"
                style={action.disabled ? { opacity: 0.4 } : undefined}
              >
                <Icon size={20} color={color} strokeWidth={1.75} />
                <View className="flex-1">
                  <Type
                    role="body"
                    weight={500}
                    style={{ color: action.destructive ? tokens.destructive : tokens.heading }}
                  >
                    {action.label}
                  </Type>
                  {action.sublabel ? (
                    <Type role="micro" style={{ color: tokens.muted }}>
                      {action.sublabel}
                    </Type>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    );
  },
);
