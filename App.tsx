import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LayoutChangeEvent } from 'react-native';
import {
  createLocalMatch,
  createLocalMatchId,
  DEFAULT_STARTING_LIFE,
  MAX_LIFE_DELTA,
  getOrCreateDeviceId,
  loadLocalMatch,
  recordLifeChange,
  saveLocalMatch,
  type LocalMatch,
  type LocalPlayer,
  type PrototypeKey,
  type RejectionReason,
} from './src/storage/localMatchStore';
import { matchSyncRuntime, type MatchSyncRuntimeSnapshot } from './src/sync/matchSyncRuntime';

type Theme = {
  key: PrototypeKey;
  name: string;
  background: string;
  text: string;
  subtle: string;
  rail: string;
  railText: string;
  border: string;
  playerColors: string[];
  radius: number;
};

type Screen = 'setup' | 'game';

type SyncWarning = {
  clientEventId: string;
  reason: RejectionReason;
};

const themes: Theme[] = [
  {
    key: 'classic',
    name: 'Classic',
    background: '#111111',
    text: '#050505',
    subtle: '#2d2d2d',
    rail: '#f8fafc',
    railText: '#111111',
    border: '#050505',
    playerColors: ['#facc15', '#fb2d63', '#fb8ff2', '#3b5bff'],
    radius: 22,
  },
  {
    key: 'ink',
    name: 'Ink',
    background: '#020617',
    text: '#f8fafc',
    subtle: '#cbd5e1',
    rail: '#0f172a',
    railText: '#f8fafc',
    border: '#f8fafc',
    playerColors: ['#0f766e', '#7c3aed', '#be123c', '#1d4ed8'],
    radius: 8,
  },
  {
    key: 'glass',
    name: 'Glass',
    background: '#e0f2fe',
    text: '#082f49',
    subtle: '#075985',
    rail: '#ffffff',
    railText: '#082f49',
    border: '#082f49',
    playerColors: ['#7dd3fc', '#a7f3d0', '#c4b5fd', '#f9a8d4'],
    radius: 30,
  },
  {
    key: 'paper',
    name: 'Paper',
    background: '#f5ead7',
    text: '#2f1e12',
    subtle: '#704214',
    rail: '#fff7ed',
    railText: '#2f1e12',
    border: '#2f1e12',
    playerColors: ['#f2c078', '#d96c75', '#a8c686', '#6daedb'],
    radius: 14,
  },
  {
    key: 'store',
    name: 'Store',
    background: '#06151f',
    text: '#e0f2fe',
    subtle: '#bae6fd',
    rail: '#082f49',
    railText: '#e0f2fe',
    border: '#38bdf8',
    playerColors: ['#155e75', '#0f766e', '#7c2d12', '#581c87'],
    radius: 4,
  },
];

const playerCounts = [2, 3, 4, 5, 6];
const startingLifeOptions = [20, 30, 40];

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [match, setMatch] = useState<LocalMatch>();
  const [prototype, setPrototype] = useState<PrototypeKey>('classic');
  const [selectedPlayerCount, setSelectedPlayerCount] = useState(4);
  const [selectedStartingLife, setSelectedStartingLife] = useState(DEFAULT_STARTING_LIFE);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [loaded, setLoaded] = useState(false);
  const [syncSnapshot, setSyncSnapshot] = useState<MatchSyncRuntimeSnapshot>(() =>
    matchSyncRuntime.getSnapshot(),
  );
  const [syncWarning, setSyncWarning] = useState<SyncWarning>();
  const matchRef = useRef<LocalMatch | undefined>(undefined);
  const { width, height } = useWindowDimensions();
  const players = match?.players ?? [];
  const startingLife = match?.startingLife ?? selectedStartingLife;

  const theme = useMemo(
    () => themes.find((candidate) => candidate.key === prototype) ?? themes[0],
    [prototype],
  );

  const columns = width > 700 || width > height ? 4 : 2;
  const rows = Math.max(1, Math.ceil(players.length / columns));
  const panelHeight = Math.max(178, (height - 92) / rows);
  const lifeSize = Math.min(columns === 4 ? 78 : 108, Math.max(68, width / 4.6));

  useEffect(() => {
    const saved = loadLocalMatch();

    if (saved) {
      const restoredMatch = {
        ...saved,
        players: applyThemeColors(saved.players, saved.prototype),
      };

      setPrototype(saved.prototype);
      setMatch(restoredMatch);
      matchRef.current = restoredMatch;
      setSelectedPlayerCount(saved.players.length);
      setSelectedStartingLife(saved.startingLife);
      setScreen('game');
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    return matchSyncRuntime.subscribe((snapshot) => {
      setSyncSnapshot(snapshot);

      if (snapshot.status === 'synced' || snapshot.status === 'queued' || snapshot.status === 'error') {
        refreshMatchFromStore();
      }

      if (snapshot.lastRejection) {
        setSyncWarning((current) =>
          current?.clientEventId === snapshot.lastRejection?.clientEventId
            ? current
            : snapshot.lastRejection,
        );
      }
    });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && matchRef.current) {
        requestSync();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!loaded || screen !== 'game') return;

    requestSync();
  }, [loaded, screen]);

  useEffect(() => {
    if (!loaded || screen !== 'game' || !matchRef.current) return;

    const currentMatch = matchRef.current;
    const nextMatch = {
      ...currentMatch,
      players: applyThemeColors(currentMatch.players, prototype),
      prototype,
      updatedAt: Date.now(),
    };

    commitMatch(nextMatch);
    saveLocalMatch(nextMatch);
  }, [loaded, prototype, screen]);

  function adjustLife(playerId: string, delta: number) {
    if (!matchRef.current) return;

    const player = matchRef.current.players.find((candidate) => candidate.playerId === playerId);
    if (!player || player.ownerDeviceId !== deviceId) return;

    commitMatch(recordLifeChange(matchRef.current, playerId, delta));
    requestSync();
  }

  function startMatch() {
    const nextMatchId = createLocalMatchId();
    const nextPlayers = createPlayers({
      count: selectedPlayerCount,
      ownerDeviceId: deviceId,
      prototype,
      startingLife: selectedStartingLife,
    });
    const nextMatch = createLocalMatch({
      localMatchId: nextMatchId,
      matchId: nextMatchId,
      players: nextPlayers,
      prototype,
      startingLife: selectedStartingLife,
    });

    saveLocalMatch(nextMatch);
    commitMatch(nextMatch);
    setScreen('game');
    requestSync();
  }

  function cyclePrototype() {
    const index = themes.findIndex((candidate) => candidate.key === prototype);
    const nextTheme = themes[(index + 1) % themes.length];
    setPrototype(nextTheme.key);
  }

  function resetMatch() {
    if (!matchRef.current) return;

    let nextMatch = matchRef.current;

    for (const player of matchRef.current.players) {
      if (player.ownerDeviceId !== deviceId) continue;

      let remainingDelta = startingLife - player.life;
      while (remainingDelta !== 0) {
        const delta = clamp(remainingDelta, -MAX_LIFE_DELTA, MAX_LIFE_DELTA);
        nextMatch = recordLifeChange(nextMatch, player.playerId, delta);
        remainingDelta -= delta;
      }
    }

    commitMatch(nextMatch);
    requestSync();
  }

  function commitMatch(nextMatch: LocalMatch) {
    const themedMatch = {
      ...nextMatch,
      players: applyThemeColors(nextMatch.players, nextMatch.prototype),
    };

    matchRef.current = themedMatch;
    setMatch(themedMatch);
  }

  function refreshMatchFromStore() {
    const saved = loadLocalMatch();
    if (!saved || !matchRef.current) return;

    commitMatch(saved);
  }

  function requestSync() {
    void matchSyncRuntime.syncNow();
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <StatusBar style={prototype === 'glass' || prototype === 'paper' ? 'dark' : 'light'} />
        {screen === 'setup' ? (
          <SetupScreen
            onSelectPlayerCount={setSelectedPlayerCount}
            onSelectStartingLife={setSelectedStartingLife}
            onStart={startMatch}
            playerCount={selectedPlayerCount}
            startingLife={selectedStartingLife}
            theme={theme}
          />
        ) : (
          <View style={[styles.appShell, { backgroundColor: theme.background }]}>
            <View style={styles.board}>
              {players.map((player, index) => {
                const isFullWidthPanel =
                  columns === 2 && players.length % 2 === 1 && index === players.length - 1;

                return (
                  <LifePanel
                    columns={columns}
                    index={index}
                    isFullWidth={isFullWidthPanel}
                    key={player.playerId}
                    lifeSize={lifeSize}
                    onAdjust={(delta) => adjustLife(player.playerId, delta)}
                    panelHeight={panelHeight}
                    player={player}
                    readOnly={player.ownerDeviceId !== deviceId}
                    theme={theme}
                  />
                );
              })}
            </View>

            <View pointerEvents="box-none" style={styles.centerControls}>
              <Pressable
                accessibilityHint="Tap to cycle prototype styles. Long press to reset all players to the match starting life."
                accessibilityLabel="Prototype menu"
                accessibilityRole="button"
                onLongPress={resetMatch}
                onPress={cyclePrototype}
                style={[styles.centerButton, { backgroundColor: theme.rail, borderColor: theme.border }]}
              >
                <Text style={[styles.centerButtonText, { color: theme.railText }]}>≡</Text>
              </Pressable>

              <SyncStatusBadge onPress={requestSync} snapshot={syncSnapshot} theme={theme} />
            </View>
            {syncWarning ? (
              <SyncWarningBanner
                onDismiss={() => setSyncWarning(undefined)}
                theme={theme}
                warning={syncWarning}
              />
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function SyncStatusBadge({
  onPress,
  snapshot,
  theme,
}: {
  onPress: () => void;
  snapshot: MatchSyncRuntimeSnapshot;
  theme: Theme;
}) {
  const disabled = !snapshot.enabled || snapshot.status === 'syncing';
  const label = syncStatusLabel(snapshot);

  return (
    <Pressable
      accessibilityHint={disabled ? undefined : 'Runs match sync now.'}
      accessibilityLabel={`Sync status: ${label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.syncBadge,
        {
          backgroundColor: theme.rail,
          borderColor: theme.border,
        },
        disabled && styles.syncBadgeDisabled,
      ]}
    >
      <View style={[styles.syncBadgeDot, { backgroundColor: syncStatusColor(snapshot) }]} />
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        numberOfLines={1}
        style={[styles.syncBadgeText, { color: theme.railText }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SyncWarningBanner({
  onDismiss,
  theme,
  warning,
}: {
  onDismiss: () => void;
  theme: Theme;
  warning: SyncWarning;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.syncWarning,
        {
          backgroundColor: theme.rail,
          borderColor: theme.border,
        },
      ]}
    >
      <Text numberOfLines={2} style={[styles.syncWarningText, { color: theme.railText }]}>
        {rejectionMessage(warning.reason)}
      </Text>
      <Pressable
        accessibilityLabel="Dismiss sync warning"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.syncWarningDismiss}
      >
        <Text style={[styles.syncWarningDismissText, { color: theme.railText }]}>×</Text>
      </Pressable>
    </View>
  );
}

function SetupScreen({
  onSelectPlayerCount,
  onSelectStartingLife,
  onStart,
  playerCount,
  startingLife,
  theme,
}: {
  onSelectPlayerCount: (count: number) => void;
  onSelectStartingLife: (life: number) => void;
  onStart: () => void;
  playerCount: number;
  startingLife: number;
  theme: Theme;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.setupShell}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: theme.background }}
    >
      <View style={styles.setupHeader}>
        <Text style={[styles.appTitle, { color: theme.rail }]}>Mana Ledger</Text>
      </View>

      <View style={styles.setupSection}>
        <Text style={[styles.setupLabel, { color: theme.rail }]}>Players</Text>
        <View style={styles.optionGrid}>
          {playerCounts.map((count) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: playerCount === count }}
              key={count}
              onPress={() => onSelectPlayerCount(count)}
              style={[
                styles.countButton,
                {
                  backgroundColor:
                    playerCount === count
                      ? theme.playerColors[(count - 2) % theme.playerColors.length]
                      : theme.rail,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[styles.countButtonText, { color: theme.text }]}>{count}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.setupSection}>
        <Text style={[styles.setupLabel, { color: theme.rail }]}>Starting Life</Text>
        <View style={styles.lifeOptionRow}>
          {startingLifeOptions.map((life) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: startingLife === life }}
              key={life}
              onPress={() => onSelectStartingLife(life)}
              style={[
                styles.lifeOptionButton,
                {
                  backgroundColor: startingLife === life ? theme.rail : 'transparent',
                  borderColor: theme.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.lifeOptionText,
                  { color: startingLife === life ? theme.railText : theme.rail },
                ]}
              >
                {life}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onStart}
        style={[styles.startButton, { backgroundColor: theme.rail, borderColor: theme.border }]}
      >
        <Text style={[styles.startButtonText, { color: theme.railText }]}>Start Game</Text>
      </Pressable>
    </ScrollView>
  );
}

function LifePanel({
  columns,
  index,
  isFullWidth,
  lifeSize,
  onAdjust,
  panelHeight,
  player,
  readOnly,
  theme,
}: {
  columns: number;
  index: number;
  isFullWidth: boolean;
  lifeSize: number;
  onAdjust: (delta: number) => void;
  panelHeight: number;
  player: LocalPlayer;
  readOnly: boolean;
  theme: Theme;
}) {
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const isRightColumn = columns === 2 && index % 2 === 1;
  const rotation = isFullWidth ? '0deg' : columns === 2 ? (isRightColumn ? '90deg' : '-90deg') : '0deg';
  const isRotated = rotation !== '0deg';
  const measuredWidth = panelSize.width || 1;
  const measuredHeight = panelSize.height || panelHeight;
  const overlayWidth = isRotated ? measuredHeight : measuredWidth;
  const overlayHeight = isRotated ? measuredWidth : measuredHeight;
  const lifeCharacters = String(player.life).length;
  const availableLifeWidth = Math.max(72, overlayWidth - 36);
  const availableLifeHeight = Math.max(54, overlayHeight - 42);
  const maxLifeSizeByWidth = availableLifeWidth / Math.max(1, lifeCharacters * 0.56);
  const maxLifeSizeByHeight = availableLifeHeight * 0.58;
  const displayedLifeSize = Math.max(48, Math.min(lifeSize, 118, maxLifeSizeByWidth, maxLifeSizeByHeight));
  const lifeLineHeight = Math.ceil(displayedLifeSize * 1.08);
  const markerBase = Math.min(measuredWidth, measuredHeight);
  const markerSize = Math.max(54, Math.min(86, markerBase * 0.32));
  const markerLineHeight = Math.ceil(markerSize * 1.02);

  function handleLayout(event: LayoutChangeEvent) {
    const { height, width } = event.nativeEvent.layout;
    setPanelSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.panel,
        {
          backgroundColor: player.color,
          borderColor: theme.border,
          borderRadius: theme.radius,
          flexBasis: isFullWidth ? '100%' : `${100 / columns}%`,
          minHeight: panelHeight,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`${player.displayName} gain 1 life`}
        accessibilityRole="button"
        accessibilityState={{ disabled: readOnly }}
        disabled={readOnly}
        onPress={() => onAdjust(1)}
        style={[styles.tapHalf, readOnly && styles.tapHalfDisabled]}
      >
        <Text
          style={[
            styles.tapMark,
            { color: theme.subtle, fontSize: markerSize, lineHeight: markerLineHeight },
          ]}
        >
          +
        </Text>
      </Pressable>

      <View
        pointerEvents="none"
        style={[
          styles.lifeOverlay,
          {
            height: overlayHeight,
            transform: [
              { translateX: -overlayWidth / 2 },
              { translateY: -overlayHeight / 2 },
              { rotate: rotation },
            ],
            width: overlayWidth,
          },
        ]}
      >
        <Text numberOfLines={1} style={[styles.playerName, { color: theme.text }]}>
          {player.displayName}
        </Text>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          numberOfLines={1}
          style={[
            styles.lifeTotal,
            {
              color: theme.text,
              fontSize: displayedLifeSize,
              lineHeight: lifeLineHeight,
            },
          ]}
        >
          {player.life}
        </Text>
      </View>

      <Pressable
        accessibilityLabel={`${player.displayName} lose 1 life`}
        accessibilityRole="button"
        accessibilityState={{ disabled: readOnly }}
        disabled={readOnly}
        onPress={() => onAdjust(-1)}
        style={[styles.tapHalf, readOnly && styles.tapHalfDisabled]}
      >
        <Text
          style={[
            styles.tapMark,
            { color: theme.subtle, fontSize: markerSize, lineHeight: markerLineHeight },
          ]}
        >
          −
        </Text>
      </Pressable>
    </View>
  );
}

function applyThemeColors(players: LocalPlayer[], prototype: PrototypeKey) {
  const theme = themes.find((candidate) => candidate.key === prototype) ?? themes[0];
  return players.map((player, index) => ({
    ...player,
    color: theme.playerColors[index % theme.playerColors.length],
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function syncStatusColor(snapshot: MatchSyncRuntimeSnapshot) {
  if (!snapshot.enabled) return '#64748b';
  if (snapshot.status === 'syncing') return '#3b82f6';
  if (snapshot.status === 'synced') return '#16a34a';
  if (snapshot.status === 'queued') return '#f59e0b';
  if (snapshot.status === 'error') return '#dc2626';

  return '#94a3b8';
}

function syncStatusLabel(snapshot: MatchSyncRuntimeSnapshot) {
  if (!snapshot.enabled) return 'Local only';
  if (snapshot.status === 'syncing') return 'Syncing';
  if (snapshot.status === 'error') return 'Sync error';
  if (snapshot.outboxCount > 0) return `${snapshot.outboxCount} queued`;
  if (snapshot.status === 'synced') return 'Synced';

  return 'Ready';
}

function rejectionMessage(reason: RejectionReason) {
  switch (reason) {
    case 'notOwner':
      return 'Score change was not accepted on this device.';
    case 'matchEnded':
      return 'Score change was not accepted because the match ended.';
    case 'playerMissing':
      return 'Score change was not accepted for this player.';
    case 'duplicateClientEventId':
      return 'Score change was already handled differently.';
    case 'invalidDelta':
    case 'serverError':
    default:
      return 'Score change was not accepted.';
  }
}

function createPlayers({
  count,
  ownerDeviceId,
  prototype,
  startingLife,
}: {
  count: number;
  ownerDeviceId: string;
  prototype: PrototypeKey;
  startingLife: number;
}) {
  const updatedAt = Date.now();

  return applyThemeColors(
    Array.from({ length: count }, (_, index) => ({
      playerId: `p${index + 1}`,
      displayName: `Player ${index + 1}`,
      life: startingLife,
      color: themes[0].playerColors[index % themes[0].playerColors.length],
      ownerDeviceId,
      updatedAt,
    })),
    prototype,
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  setupShell: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 26,
  },
  setupHeader: {
    marginBottom: 44,
  },
  appTitle: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 0,
  },
  setupSection: {
    marginBottom: 30,
  },
  setupLabel: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 12,
    opacity: 0.82,
    textTransform: 'uppercase',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  countButton: {
    alignItems: 'center',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 3,
    flexBasis: '31%',
    justifyContent: 'center',
    minWidth: 86,
  },
  countButtonText: {
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lifeOptionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  lifeOptionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 70,
  },
  lifeOptionText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
  },
  startButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 74,
  },
  startButtonText: {
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0,
  },
  appShell: {
    flex: 1,
    padding: 10,
  },
  board: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  panel: {
    alignItems: 'center',
    borderWidth: 3,
    flexGrow: 1,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  tapHalf: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  tapHalfDisabled: {
    opacity: 0.45,
  },
  tapMark: {
    fontWeight: '900',
    opacity: 0.72,
  },
  lifeOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    left: '50%',
    padding: 16,
    position: 'absolute',
    top: '50%',
    zIndex: 2,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 2,
    opacity: 0.9,
  },
  lifeTotal: {
    fontWeight: '900',
    letterSpacing: 0,
    paddingHorizontal: 10,
    textAlign: 'center',
  },
  deltaHint: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: -10,
    opacity: 0.55,
  },
  centerControls: {
    alignItems: 'center',
    gap: 8,
    left: '50%',
    position: 'absolute',
    top: '50%',
    transform: [{ translateX: -129 }, { translateY: -45 }],
    width: 258,
    zIndex: 5,
  },
  centerButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 3,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  centerButtonText: {
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 30,
  },
  syncBadge: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 36,
    width: 126,
    paddingHorizontal: 10,
  },
  syncBadgeDisabled: {
    opacity: 0.88,
  },
  syncBadgeDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  syncBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    maxWidth: 86,
    textTransform: 'uppercase',
  },
  syncWarning: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 2,
    bottom: 16,
    flexDirection: 'row',
    gap: 8,
    left: 16,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
    right: 16,
    zIndex: 8,
  },
  syncWarningDismiss: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  syncWarningDismissText: {
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 25,
  },
  syncWarningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 16,
  },
});
