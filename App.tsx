import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type PrototypeKey = 'arena' | 'neon' | 'parchment' | 'minimal' | 'tournament';

type Player = {
  id: string;
  name: string;
  life: number;
  poison: number;
  commander: number;
  accent: string;
};

type LifeEvent = {
  id: string;
  playerId: string;
  delta: number;
  at: string;
};

type Theme = {
  key: PrototypeKey;
  name: string;
  tagline: string;
  description: string;
  statusBar: 'light' | 'dark';
  root: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  positive: string;
  negative: string;
  hero: string;
  chip: string;
  shadow: string;
  radius: number;
  cardStyle: 'split' | 'glow' | 'paper' | 'flat' | 'broadcast';
};

const STORAGE_KEY = 'mtg-life-tracker:v1';

const startingPlayers: Player[] = [
  { id: 'p1', name: 'Ajani', life: 40, poison: 0, commander: 0, accent: '#f7c948' },
  { id: 'p2', name: 'Liliana', life: 40, poison: 0, commander: 0, accent: '#b794f4' },
  { id: 'p3', name: 'Chandra', life: 40, poison: 0, commander: 0, accent: '#fb7185' },
  { id: 'p4', name: 'Nissa', life: 40, poison: 0, commander: 0, accent: '#34d399' },
];

const themes: Theme[] = [
  {
    key: 'arena',
    name: 'Arena Command',
    tagline: 'High-contrast table dashboard',
    description: 'Large readable panels for Commander pods and casual tables.',
    statusBar: 'light',
    root: '#111827',
    surface: '#1f2937',
    surfaceAlt: '#273449',
    text: '#f9fafb',
    muted: '#cbd5e1',
    border: '#374151',
    positive: '#22c55e',
    negative: '#ef4444',
    hero: '#60a5fa',
    chip: '#172554',
    shadow: '#020617',
    radius: 28,
    cardStyle: 'split',
  },
  {
    key: 'neon',
    name: 'Neon Stack',
    tagline: 'Arcade-inspired fast tapping',
    description: 'Glowing controls, chunky numbers, and dramatic game-state cues.',
    statusBar: 'light',
    root: '#070014',
    surface: '#18002f',
    surfaceAlt: '#220044',
    text: '#f5e8ff',
    muted: '#c084fc',
    border: '#7e22ce',
    positive: '#00f5d4',
    negative: '#ff3d81',
    hero: '#f0abfc',
    chip: '#2e1065',
    shadow: '#fb00ff',
    radius: 18,
    cardStyle: 'glow',
  },
  {
    key: 'parchment',
    name: 'Spellbook',
    tagline: 'Warm paper and fantasy texture',
    description: 'A board-game companion feel for casual pods and kitchen tables.',
    statusBar: 'dark',
    root: '#f7ead0',
    surface: '#fff7e6',
    surfaceAlt: '#f2dca7',
    text: '#342312',
    muted: '#7c5c34',
    border: '#c49b57',
    positive: '#2f855a',
    negative: '#b91c1c',
    hero: '#9a3412',
    chip: '#fef3c7',
    shadow: '#8b5e34',
    radius: 12,
    cardStyle: 'paper',
  },
  {
    key: 'minimal',
    name: 'Quiet Match',
    tagline: 'Calm, battery-friendly, low noise',
    description: 'Clean typography for players who want the counter to disappear.',
    statusBar: 'dark',
    root: '#f8fafc',
    surface: '#ffffff',
    surfaceAlt: '#eef2ff',
    text: '#0f172a',
    muted: '#64748b',
    border: '#dbe3ef',
    positive: '#16a34a',
    negative: '#dc2626',
    hero: '#2563eb',
    chip: '#e0e7ff',
    shadow: '#94a3b8',
    radius: 24,
    cardStyle: 'flat',
  },
  {
    key: 'tournament',
    name: 'Store Ops',
    tagline: 'Round-ready and judge-visible',
    description: 'Competition mode concept with table, timer, sync queue, and reporting.',
    statusBar: 'light',
    root: '#071018',
    surface: '#0d1b2a',
    surfaceAlt: '#12324a',
    text: '#f8fafc',
    muted: '#a7c7d9',
    border: '#23506b',
    positive: '#84cc16',
    negative: '#f97316',
    hero: '#38bdf8',
    chip: '#082f49',
    shadow: '#000000',
    radius: 8,
    cardStyle: 'broadcast',
  },
];

export default function App() {
  const [themeKey, setThemeKey] = useState<PrototypeKey>('arena');
  const [players, setPlayers] = useState<Player[]>(startingPlayers);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const theme = useMemo(
    () => themes.find((candidate) => candidate.key === themeKey) ?? themes[0],
    [themeKey],
  );

  useEffect(() => {
    async function restoreLocalMatch() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            themeKey?: PrototypeKey;
            players?: Player[];
            events?: LifeEvent[];
          };
          if (saved.themeKey) setThemeKey(saved.themeKey);
          if (saved.players) setPlayers(saved.players);
          if (saved.events) setEvents(saved.events);
        }
      } catch (error) {
        console.warn('Unable to restore local match', error);
      } finally {
        setLoaded(true);
      }
    }

    restoreLocalMatch();
  }, []);

  useEffect(() => {
    if (!loaded) return;

    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ themeKey, players, events }),
    ).catch((error) => console.warn('Unable to persist local match', error));
  }, [events, loaded, players, themeKey]);

  const totalLife = players.reduce((sum, player) => sum + player.life, 0);
  const recentEvents = events.slice(0, 4);

  function adjustLife(playerId: string, delta: number) {
    const event: LifeEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      playerId,
      delta,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setPlayers((current) =>
      current.map((player) =>
        player.id === playerId ? { ...player, life: player.life + delta } : player,
      ),
    );
    setEvents((current) => [event, ...current].slice(0, 50));
  }

  function bumpCounter(playerId: string, key: 'poison' | 'commander', delta: number) {
    setPlayers((current) =>
      current.map((player) =>
        player.id === playerId
          ? { ...player, [key]: Math.max(0, player[key] + delta) }
          : player,
      ),
    );
  }

  function resetMatch() {
    setPlayers(startingPlayers);
    setEvents([]);
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.root }]}>
      <StatusBar style={theme.statusBar} />
      <ScrollView
        contentContainerStyle={[styles.screen, { backgroundColor: theme.root }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={[styles.kicker, { color: theme.hero }]}>Local-first life tracker</Text>
            <Text style={[styles.title, { color: theme.text }]}>Mana Ledger</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>{theme.description}</Text>
          </View>
          <Pressable
            onPress={resetMatch}
            style={({ pressed }) => [
              styles.resetButton,
              { borderColor: theme.border, backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Text style={[styles.resetText, { color: theme.text }]}>Reset 40</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={styles.prototypeRail}
          showsHorizontalScrollIndicator={false}
        >
          {themes.map((candidate) => {
            const active = candidate.key === theme.key;
            return (
              <Pressable
                key={candidate.key}
                onPress={() => setThemeKey(candidate.key)}
                style={({ pressed }) => [
                  styles.prototypeTab,
                  {
                    backgroundColor: active ? theme.hero : theme.surface,
                    borderColor: active ? theme.hero : theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.prototypeName, { color: active ? theme.root : theme.text }]}>
                  {candidate.name}
                </Text>
                <Text style={[styles.prototypeTagline, { color: active ? theme.root : theme.muted }]}>
                  {candidate.tagline}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={[
            styles.matchPanel,
            panelShadow(theme),
            { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.radius },
          ]}
        >
          <View>
            <Text style={[styles.panelLabel, { color: theme.hero }]}>Prototype</Text>
            <Text style={[styles.panelTitle, { color: theme.text }]}>{theme.name}</Text>
          </View>
          <View style={styles.matchStats}>
            <StatPill label="Round" value="2" theme={theme} />
            <StatPill label="Table" value="14" theme={theme} />
            <StatPill label="Total life" value={`${totalLife}`} theme={theme} />
          </View>
        </View>

        <View style={styles.grid}>
          {players.map((player, index) => (
            <PlayerCard
              index={index}
              key={player.id}
              onAdjust={(delta) => adjustLife(player.id, delta)}
              onCounter={(counter, delta) => bumpCounter(player.id, counter, delta)}
              player={player}
              theme={theme}
            />
          ))}
        </View>

        <View style={styles.bottomGrid}>
          <View
            style={[
              styles.syncCard,
              { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.radius },
              panelShadow(theme),
            ]}
          >
            <Text style={[styles.panelLabel, { color: theme.hero }]}>Sync design</Text>
            <Text style={[styles.syncTitle, { color: theme.text }]}>Local event log first</Text>
            <Text style={[styles.syncCopy, { color: theme.muted }]}>Every life change is stored locally immediately. Later, the same event stream can flush to Convex, PowerSync, or Supabase with idempotent event IDs.</Text>
            <View style={styles.syncRows}>
              <SyncRow label="Local persistence" value="AsyncStorage MVP" theme={theme} />
              <SyncRow label="Queued events" value={`${events.length}/50`} theme={theme} />
              <SyncRow label="Future backend" value="Convex candidate" theme={theme} />
            </View>
          </View>

          <View
            style={[
              styles.syncCard,
              { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.radius },
              panelShadow(theme),
            ]}
          >
            <Text style={[styles.panelLabel, { color: theme.hero }]}>Recent changes</Text>
            {recentEvents.length === 0 ? (
              <Text style={[styles.emptyLog, { color: theme.muted }]}>Tap a life control to create the first local event.</Text>
            ) : (
              recentEvents.map((event) => {
                const player = players.find((candidate) => candidate.id === event.playerId);
                const positive = event.delta > 0;
                return (
                  <View key={event.id} style={[styles.logRow, { borderBottomColor: theme.border }]}> 
                    <Text style={[styles.logName, { color: theme.text }]}>{player?.name ?? 'Player'}</Text>
                    <Text style={[styles.logDelta, { color: positive ? theme.positive : theme.negative }]}> 
                      {positive ? '+' : ''}{event.delta}
                    </Text>
                    <Text style={[styles.logTime, { color: theme.muted }]}>{event.at}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlayerCard({
  index,
  onAdjust,
  onCounter,
  player,
  theme,
}: {
  index: number;
  onAdjust: (delta: number) => void;
  onCounter: (counter: 'poison' | 'commander', delta: number) => void;
  player: Player;
  theme: Theme;
}) {
  const danger = player.life <= 10 || player.poison >= 8 || player.commander >= 18;
  const eliminated = player.life <= 0 || player.poison >= 10 || player.commander >= 21;

  return (
    <View
      style={[
        styles.playerCard,
        cardSpecificStyle(theme, player.accent),
        panelShadow(theme),
        { borderRadius: theme.radius, borderColor: danger ? theme.negative : theme.border },
      ]}
    >
      <View style={styles.cardTopRow}>
        <View>
          <Text style={[styles.seatLabel, { color: theme.muted }]}>Seat {index + 1}</Text>
          <Text style={[styles.playerName, { color: theme.text }]}>{player.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: eliminated ? theme.negative : theme.chip }]}> 
          <Text style={[styles.statusText, { color: eliminated ? '#ffffff' : theme.hero }]}>
            {eliminated ? 'OUT' : 'LIVE'}
          </Text>
        </View>
      </View>

      <View style={styles.lifeRow}>
        <LifeButton label="−5" onPress={() => onAdjust(-5)} theme={theme} tone="down" />
        <LifeButton label="−1" onPress={() => onAdjust(-1)} theme={theme} tone="down" />
        <View style={styles.lifeStack}>
          <Text style={[styles.lifeTotal, { color: eliminated ? theme.negative : theme.text }]}>
            {player.life}
          </Text>
          <Text style={[styles.lifeLabel, { color: theme.muted }]}>life</Text>
        </View>
        <LifeButton label="+1" onPress={() => onAdjust(1)} theme={theme} tone="up" />
        <LifeButton label="+5" onPress={() => onAdjust(5)} theme={theme} tone="up" />
      </View>

      <View style={styles.counterRow}>
        <CounterControl label="Poison" value={player.poison} onMinus={() => onCounter('poison', -1)} onPlus={() => onCounter('poison', 1)} theme={theme} />
        <CounterControl label="Commander" value={player.commander} onMinus={() => onCounter('commander', -1)} onPlus={() => onCounter('commander', 1)} theme={theme} />
      </View>
    </View>
  );
}

function LifeButton({
  label,
  onPress,
  theme,
  tone,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  tone: 'up' | 'down';
}) {
  const color = tone === 'up' ? theme.positive : theme.negative;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.lifeButton,
        { backgroundColor: color, opacity: pressed ? 0.62 : 1 },
      ]}
    >
      <Text style={styles.lifeButtonText}>{label}</Text>
    </Pressable>
  );
}

function CounterControl({
  label,
  onMinus,
  onPlus,
  theme,
  value,
}: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  theme: Theme;
  value: number;
}) {
  return (
    <View style={[styles.counterControl, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}> 
      <Text style={[styles.counterLabel, { color: theme.muted }]}>{label}</Text>
      <View style={styles.counterButtons}>
        <Pressable onPress={onMinus} style={[styles.counterButton, { borderColor: theme.border }]}> 
          <Text style={[styles.counterButtonText, { color: theme.text }]}>−</Text>
        </Pressable>
        <Text style={[styles.counterValue, { color: theme.text }]}>{value}</Text>
        <Pressable onPress={onPlus} style={[styles.counterButton, { borderColor: theme.border }]}> 
          <Text style={[styles.counterButtonText, { color: theme.text }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatPill({ label, theme, value }: { label: string; theme: Theme; value: string }) {
  return (
    <View style={[styles.statPill, { backgroundColor: theme.chip, borderColor: theme.border }]}> 
      <Text style={[styles.statLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function SyncRow({ label, theme, value }: { label: string; theme: Theme; value: string }) {
  return (
    <View style={[styles.syncRow, { borderBottomColor: theme.border }]}> 
      <Text style={[styles.syncRowLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.syncRowValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function panelShadow(theme: Theme) {
  return {
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: theme.key === 'minimal' ? 0.12 : 0.28,
    shadowRadius: theme.key === 'neon' ? 18 : 10,
    elevation: 8,
  };
}

function cardSpecificStyle(theme: Theme, accent: string) {
  switch (theme.cardStyle) {
    case 'glow':
      return { backgroundColor: theme.surface, borderWidth: 2, borderTopColor: accent };
    case 'paper':
      return { backgroundColor: theme.surface, borderWidth: 1.5, borderLeftWidth: 8, borderLeftColor: accent };
    case 'flat':
      return { backgroundColor: theme.surface, borderWidth: 1 };
    case 'broadcast':
      return { backgroundColor: theme.surface, borderWidth: 1, borderTopWidth: 6, borderTopColor: accent };
    case 'split':
    default:
      return { backgroundColor: theme.surface, borderWidth: 1, borderLeftWidth: 6, borderLeftColor: accent };
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    gap: 18,
    padding: 18,
    paddingBottom: 36,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
  },
  resetButton: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  resetText: {
    fontSize: 13,
    fontWeight: '800',
  },
  prototypeRail: {
    gap: 10,
    paddingRight: 18,
  },
  prototypeTab: {
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 154,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  prototypeName: {
    fontSize: 14,
    fontWeight: '900',
  },
  prototypeTagline: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
    marginTop: 3,
  },
  matchPanel: {
    alignItems: 'flex-start',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    padding: 18,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  matchStats: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    maxWidth: 210,
  },
  statPill: {
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  grid: {
    gap: 14,
  },
  playerCard: {
    gap: 18,
    padding: 18,
  },
  cardTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  seatLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  playerName: {
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  lifeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'space-between',
  },
  lifeButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 52,
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 9,
  },
  lifeButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  lifeStack: {
    alignItems: 'center',
    flex: 1,
  },
  lifeTotal: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -3,
  },
  lifeLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginTop: -6,
    textTransform: 'uppercase',
  },
  counterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  counterControl: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  counterLabel: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  counterButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  counterButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  counterButtonText: {
    fontSize: 19,
    fontWeight: '900',
  },
  counterValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  bottomGrid: {
    gap: 14,
  },
  syncCard: {
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  syncTitle: {
    fontSize: 21,
    fontWeight: '900',
  },
  syncCopy: {
    fontSize: 14,
    lineHeight: 20,
  },
  syncRows: {
    marginTop: 4,
  },
  syncRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  syncRowLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  syncRowValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  emptyLog: {
    fontSize: 14,
    lineHeight: 20,
  },
  logRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 9,
  },
  logName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
  },
  logDelta: {
    fontSize: 16,
    fontWeight: '900',
  },
  logTime: {
    fontSize: 12,
    fontWeight: '700',
  },
});
