import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  createLifeChangedEvent,
  createLocalMatchSnapshot,
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

const initialPlayers: Player[] = [
  { id: 'p1', name: 'Player 1', life: 40, color: themes[0].playerColors[0] },
  { id: 'p2', name: 'Player 2', life: 40, color: themes[0].playerColors[1] },
  { id: 'p3', name: 'Player 3', life: 40, color: themes[0].playerColors[2] },
  { id: 'p4', name: 'Player 4', life: 40, color: themes[0].playerColors[3] },
];

export default function App() {
  const [prototype, setPrototype] = useState<PrototypeKey>('classic');
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
      setEvents(saved.events);
      setOutbox(saved.outbox);
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;

    saveLocalMatch(
      createLocalMatchSnapshot({
        events,
        outbox,
        players,
        prototype,
      }),
    );
  }, [events, loaded, outbox, players, prototype]);

  useEffect(() => {
    setPlayers((current) => {
      const themedPlayers = applyThemeColors(current, prototype);
      playersRef.current = themedPlayers;
      return themedPlayers;
    });
  }, [prototype]);

  function adjustLife(playerId: string, delta: number) {
    const player = playersRef.current.find((candidate) => candidate.id === playerId);
    if (!player) return;

    const nextLife = player.life + delta;
    const event = createLifeChangedEvent({
      delta,
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

  function cyclePrototype() {
    const index = themes.findIndex((candidate) => candidate.key === prototype);
    const nextTheme = themes[(index + 1) % themes.length];
    setPrototype(nextTheme.key);
  }

  function resetMatch() {
    const resetPlayers = applyThemeColors(initialPlayers, prototype);
    playersRef.current = resetPlayers;
    setPlayers(resetPlayers);
    setEvents([]);
    setOutbox([]);
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <StatusBar style={prototype === 'classic' || prototype === 'glass' || prototype === 'paper' ? 'dark' : 'light'} />
      <View style={[styles.appShell, { backgroundColor: theme.background }]}> 
        <View style={styles.board}>
          {players.map((player, index) => (
            <LifePanel
              columns={columns}
              index={index}
              key={player.id}
              lifeSize={lifeSize}
              onAdjust={(delta) => adjustLife(player.id, delta)}
              panelHeight={panelHeight}
              player={player}
              theme={theme}
            />
          ))}
        </View>

        <Pressable
          accessibilityHint="Tap to cycle prototype styles. Long press to reset all players to 40 life."
          accessibilityLabel="Prototype menu"
          accessibilityRole="button"
          onLongPress={resetMatch}
          onPress={cyclePrototype}
          style={[styles.centerButton, { backgroundColor: theme.rail, borderColor: theme.border }]}
        >
          <Text style={[styles.centerButtonText, { color: theme.railText }]}>≡</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function LifePanel({
  columns,
  index,
  lifeSize,
  onAdjust,
  panelHeight,
  player,
  theme,
}: {
  columns: number;
  index: number;
  lifeSize: number;
  onAdjust: (delta: number) => void;
  panelHeight: number;
  player: Player;
  theme: Theme;
}) {
  const isRightColumn = columns === 2 && index % 2 === 1;
  const rotation = columns === 2 ? (isRightColumn ? '90deg' : '-90deg') : '0deg';
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: player.color,
          borderColor: theme.border,
          borderRadius: theme.radius,
          flexBasis: `${100 / columns}%`,
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
        <Text style={[styles.tapMark, { color: theme.subtle }]}>+</Text>
      </Pressable>

      <View style={[styles.lifeOverlay, { pointerEvents: 'none', transform: [{ rotate: rotation }] }]}> 
        <Text style={[styles.playerName, { color: theme.text }]}>{player.name}</Text>
        <Text style={[styles.lifeTotal, { color: theme.text, fontSize: lifeSize }]}>{player.life}</Text>
      </View>

      <Pressable
        accessibilityLabel={`${player.name} lose 1 life`}
        accessibilityRole="button"
        onPress={() => onAdjust(-1)}
        style={styles.tapHalf}
      >
        <Text style={[styles.tapMark, { color: theme.subtle }]}>−</Text>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
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
    fontSize: 22,
    fontWeight: '900',
    opacity: 0.65,
  },
  lifeOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '26%',
    zIndex: 2,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginBottom: -6,
    opacity: 0.9,
  },
  lifeTotal: {
    fontWeight: '900',
    letterSpacing: -5,
    lineHeight: 116,
  },
  deltaHint: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
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
