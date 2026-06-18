import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  createLifeChangedEvent,
  createLocalMatchId,
  createLocalMatchSnapshot,
  DEFAULT_STARTING_LIFE,
  loadLocalMatch,
  saveLocalMatch,
  type LifeEvent,
  type Player,
  type PrototypeKey,
  type QueuedLifeEvent,
} from './src/storage/localMatchStore';

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

const initialPlayers = createPlayers({
  count: 4,
  prototype: 'classic',
  startingLife: DEFAULT_STARTING_LIFE,
});

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [activeMatchId, setActiveMatchId] = useState<string>();
  const [prototype, setPrototype] = useState<PrototypeKey>('classic');
  const [selectedPlayerCount, setSelectedPlayerCount] = useState(4);
  const [selectedStartingLife, setSelectedStartingLife] = useState(DEFAULT_STARTING_LIFE);
  const [startingLife, setStartingLife] = useState(DEFAULT_STARTING_LIFE);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [outbox, setOutbox] = useState<QueuedLifeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const playersRef = useRef(initialPlayers);
  const { width, height } = useWindowDimensions();

  const theme = useMemo(
    () => themes.find((candidate) => candidate.key === prototype) ?? themes[0],
    [prototype],
  );

  const columns = width > 700 || width > height ? 4 : 2;
  const rows = Math.ceil(players.length / columns);
  const panelHeight = Math.max(178, (height - 92) / rows);
  const lifeSize = Math.min(columns === 4 ? 78 : 108, Math.max(68, width / 4.6));

  useEffect(() => {
    const saved = loadLocalMatch();

    if (saved) {
      const restoredPlayers = applyThemeColors(saved.players, saved.prototype);

      setPrototype(saved.prototype);
      setPlayers(restoredPlayers);
      playersRef.current = restoredPlayers;
      setActiveMatchId(saved.activeMatchId);
      setStartingLife(saved.startingLife);
      setSelectedPlayerCount(saved.players.length);
      setSelectedStartingLife(saved.startingLife);
      setEvents(saved.events);
      setOutbox(saved.outbox);
      setScreen('game');
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || screen !== 'game' || !activeMatchId) return;

    saveLocalMatch(
      createLocalMatchSnapshot({
        activeMatchId,
        events,
        outbox,
        players,
        prototype,
        startingLife,
      }),
    );
  }, [activeMatchId, events, loaded, outbox, players, prototype, screen, startingLife]);

  useEffect(() => {
    setPlayers((current) => {
      const themedPlayers = applyThemeColors(current, prototype);
      playersRef.current = themedPlayers;
      return themedPlayers;
    });
  }, [prototype]);

  function adjustLife(playerId: string, delta: number) {
    if (!activeMatchId) return;

    const player = playersRef.current.find((candidate) => candidate.id === playerId);
    if (!player) return;

    const nextLife = player.life + delta;
    const event = createLifeChangedEvent({
      delta,
      matchId: activeMatchId,
      nextLife,
      playerId,
      previousLife: player.life,
    });
    const nextPlayers = playersRef.current.map((candidate) =>
      candidate.id === playerId ? { ...candidate, life: nextLife } : candidate,
    );

    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
    setEvents((current) => [event, ...current].slice(0, 100));
    setOutbox((current) => [...current, { event, status: 'pending' }]);
  }

  function startMatch() {
    const nextActiveMatchId = createLocalMatchId();
    const nextPlayers = createPlayers({
      count: selectedPlayerCount,
      prototype,
      startingLife: selectedStartingLife,
    });
    const nextEvents: LifeEvent[] = [];
    const nextOutbox: QueuedLifeEvent[] = [];

    saveLocalMatch(
      createLocalMatchSnapshot({
        activeMatchId: nextActiveMatchId,
        events: nextEvents,
        outbox: nextOutbox,
        players: nextPlayers,
        prototype,
        startingLife: selectedStartingLife,
      }),
    );

    playersRef.current = nextPlayers;
    setActiveMatchId(nextActiveMatchId);
    setStartingLife(selectedStartingLife);
    setPlayers(nextPlayers);
    setEvents(nextEvents);
    setOutbox(nextOutbox);
    setScreen('game');
  }

  function cyclePrototype() {
    const index = themes.findIndex((candidate) => candidate.key === prototype);
    const nextTheme = themes[(index + 1) % themes.length];
    setPrototype(nextTheme.key);
  }

  function resetMatch() {
    const resetPlayers = createPlayers({
      count: playersRef.current.length,
      prototype,
      startingLife,
    });
    playersRef.current = resetPlayers;
    setPlayers(resetPlayers);
    setEvents([]);
    setOutbox([]);
  }

  return (
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
                  key={player.id}
                  lifeSize={lifeSize}
                  onAdjust={(delta) => adjustLife(player.id, delta)}
                  panelHeight={panelHeight}
                  player={player}
                  theme={theme}
                />
              );
            })}
          </View>

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
        </View>
      )}
    </SafeAreaView>
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
  theme,
}: {
  columns: number;
  index: number;
  isFullWidth: boolean;
  lifeSize: number;
  onAdjust: (delta: number) => void;
  panelHeight: number;
  player: Player;
  theme: Theme;
}) {
  const isRightColumn = columns === 2 && index % 2 === 1;
  const rotation = isFullWidth ? '0deg' : columns === 2 ? (isRightColumn ? '90deg' : '-90deg') : '0deg';
  const lifeDigits = String(player.life).replace('-', '').length;
  const displayedLifeSize = Math.max(54, lifeSize - Math.max(0, lifeDigits - 2) * 12);
  const lifeLineHeight = Math.ceil(displayedLifeSize * 1.2);
  const markerSize = Math.max(36, Math.min(54, displayedLifeSize * 0.48));
  const markerLineHeight = Math.ceil(markerSize * 1.08);

  return (
    <View
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
        accessibilityLabel={`${player.name} gain 1 life`}
        accessibilityRole="button"
        onPress={() => onAdjust(1)}
        style={styles.tapHalf}
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

      <View pointerEvents="none" style={[styles.lifeOverlay, { transform: [{ rotate: rotation }] }]}>
        <Text style={[styles.playerName, { color: theme.text }]}>{player.name}</Text>
        <Text
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
        accessibilityLabel={`${player.name} lose 1 life`}
        accessibilityRole="button"
        onPress={() => onAdjust(-1)}
        style={styles.tapHalf}
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

function applyThemeColors(players: Player[], prototype: PrototypeKey) {
  const theme = themes.find((candidate) => candidate.key === prototype) ?? themes[0];
  return players.map((player, index) => ({
    ...player,
    color: theme.playerColors[index % theme.playerColors.length],
  }));
}

function createPlayers({
  count,
  prototype,
  startingLife,
}: {
  count: number;
  prototype: PrototypeKey;
  startingLife: number;
}) {
  return applyThemeColors(
    Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      life: startingLife,
      color: themes[0].playerColors[index % themes[0].playerColors.length],
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
  tapMark: {
    fontWeight: '900',
    opacity: 0.72,
  },
  lifeOverlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: -6,
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
  centerButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 3,
    height: 46,
    justifyContent: 'center',
    left: '50%',
    position: 'absolute',
    top: '50%',
    transform: [{ translateX: -23 }, { translateY: -23 }],
    width: 46,
    zIndex: 5,
  },
  centerButtonText: {
    fontSize: 27,
    fontWeight: '900',
    lineHeight: 30,
  },
});
