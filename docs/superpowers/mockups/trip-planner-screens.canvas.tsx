import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Select,
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
  TextArea,
  TextInput,
  Toggle,
  UsageBar,
  useCanvasState,
  useEffect,
  useHostTheme,
  useRef,
  useState,
  type CSSProperties,
  type Color,
} from "cursor/canvas";

type Node = ReturnType<typeof Text> | string | number | null | undefined | boolean | Node[];

// ---------------------------------------------------------------------------
// Screen registry
// ---------------------------------------------------------------------------

type ScreenId =
  | "home"
  | "brief"
  | "generating"
  | "plan"
  | "blocked"
  | "upgrade"
  | "myplans"
  | "admin";

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "home", label: "1 · Home / Globe" },
  { id: "brief", label: "2 · Trip Brief" },
  { id: "generating", label: "3 · Generating" },
  { id: "plan", label: "4 · Plan view" },
  { id: "blocked", label: "5 · Can't fit" },
  { id: "upgrade", label: "6 · Upgrade" },
  { id: "myplans", label: "7 · My plans" },
  { id: "admin", label: "8 · Admin" },
];

// ---------------------------------------------------------------------------
// Locale registry — adding a language = adding one row here (+ its strings file).
// `dir` drives layout direction; `enabled` gates what users can pick today.
// ---------------------------------------------------------------------------

const LANGUAGES: { code: string; native: string; dir: "ltr" | "rtl"; enabled: boolean }[] = [
  { code: "en", native: "English", dir: "ltr", enabled: true },
  { code: "he", native: "עברית", dir: "rtl", enabled: true },
  { code: "es", native: "Español · soon", dir: "ltr", enabled: false },
  { code: "fr", native: "Français · soon", dir: "ltr", enabled: false },
  { code: "ar", native: "العربية · soon", dir: "rtl", enabled: false },
];

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function Frame({
  url,
  children,
  dir,
}: {
  url: string;
  children: Node;
  dir?: "ltr" | "rtl";
}) {
  const t = useHostTheme();
  return (
    <div
      dir={dir ?? "ltr"}
      style={{
        border: `1px solid ${t.stroke.primary}`,
        borderRadius: 8,
        background: t.bg.editor,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: t.bg.chrome,
          borderBottom: `1px solid ${t.stroke.tertiary}`,
        }}
      >
        <span style={dot(t.fill.primary)} />
        <span style={dot(t.fill.primary)} />
        <span style={dot(t.fill.primary)} />
        <div
          style={{
            marginLeft: 8,
            flex: 1,
            padding: "2px 10px",
            borderRadius: 4,
            background: t.fill.quaternary,
            color: t.text.tertiary,
            fontSize: 11,
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function dot(bg: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: 4, background: bg, display: "inline-block" };
}

function TopNav({
  signedIn,
  tier,
  lang,
  onLang,
  onSignIn,
}: {
  signedIn: boolean;
  tier?: "Free" | "Plus";
  lang: "en" | "he";
  onLang: (l: "en" | "he") => void;
  onSignIn?: () => void;
}) {
  const t = useHostTheme();
  return (
    <Row gap={12} align="center" style={{ marginBottom: 14 }}>
      <Text weight="semibold">Wayfare</Text>
      <Text tone="tertiary" size="small">
        {lang === "he" ? "מסלולים" : "Trips"}
      </Text>
      <Text tone="tertiary" size="small">
        {lang === "he" ? "תמחור" : "Pricing"}
      </Text>
      <Spacer />
      <Select
        value={lang}
        onChange={(v) => onLang(v === "he" ? "he" : "en")}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.native, disabled: !l.enabled }))}
        style={{ width: 128 }}
      />
      {signedIn ? (
        <Row gap={8} align="center">
          {tier && <Pill size="sm">{tier}</Pill>}
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: t.accent.primary,
              color: t.text.onAccent,
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ID
          </span>
        </Row>
      ) : (
        <Button variant="secondary" onClick={onSignIn}>
          Sign in with Google
        </Button>
      )}
    </Row>
  );
}

function GoogleMark() {
  const t = useHostTheme();
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle cx={8} cy={8} r={7} fill="none" stroke={t.text.primary} strokeWidth={1.6} />
      <path d="M8 7h5.5" stroke={t.text.primary} strokeWidth={1.6} />
      <path d="M13.5 7a5.5 5.5 0 0 1 -1.6 4.2" stroke={t.text.primary} strokeWidth={1.6} fill="none" />
    </svg>
  );
}

function SignInGate({
  destination,
  lang,
  onSignedIn,
  onCancel,
}: {
  destination: string;
  lang: "en" | "he";
  onSignedIn: () => void;
  onCancel: () => void;
}) {
  const t = useHostTheme();
  const he = lang === "he";
  return (
    <div
      style={{
        border: `1px solid ${t.accent.primary}`,
        borderRadius: 8,
        padding: 16,
        background: t.bg.elevated,
      }}
    >
      <Stack gap={10}>
        <Row gap={8} align="center">
          <Text weight="semibold">{he ? "התחברות נדרשת" : "Sign in to start planning"}</Text>
          <Spacer />
          <Pill size="sm">modal</Pill>
        </Row>
        <Text size="small" tone="secondary">
          {he
            ? `כדי לתכנן את ${destination} נצטרך חשבון Google. זהו הדבר היחיד שנבקש — אין סיסמה, אין טופס.`
            : `To plan ${destination} we need a Google account. That's all we ask — no password, no form.`}
        </Text>
        <Row gap={8} align="center">
          <Button variant="primary" onClick={onSignedIn}>
            <Row gap={6} align="center">
              <GoogleMark />
              <span>{he ? "המשך עם Google" : "Continue with Google"}</span>
            </Row>
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {he ? "ביטול" : "Cancel"}
          </Button>
        </Row>
        <Text size="small" tone="quaternary">
          {he
            ? "אחרי ההתחברות נחזיר אותך ישר לתכנון של אותו יעד."
            : "After sign-in you return straight to planning this destination."}
        </Text>
      </Stack>
    </div>
  );
}

function Note({ children }: { children: Node }) {
  return (
    <Text size="small" tone="tertiary" italic>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — Home / Globe
// ---------------------------------------------------------------------------

// --- geography (coarse, for the mockup only) --------------------------------

type Place = {
  name: string;
  he: string;
  lat: number;
  lng: number;
  regions: string[];
  kind?: "country" | "city";
  country?: string;
};

// Cities resolve to a point and offer "city only / city + around / whole country" scopes.
const CITIES: Place[] = [
  { name: "Tel Aviv", he: "תל אביב", lat: 32.08, lng: 34.78, kind: "city", country: "Israel", regions: [] },
  { name: "Jerusalem", he: "ירושלים", lat: 31.77, lng: 35.21, kind: "city", country: "Israel", regions: [] },
  { name: "Rome", he: "רומא", lat: 41.9, lng: 12.5, kind: "city", country: "Italy", regions: [] },
  { name: "Florence", he: "פירנצה", lat: 43.77, lng: 11.25, kind: "city", country: "Italy", regions: [] },
  { name: "Venice", he: "ונציה", lat: 45.44, lng: 12.33, kind: "city", country: "Italy", regions: [] },
  { name: "Milan", he: "מילאנו", lat: 45.46, lng: 9.19, kind: "city", country: "Italy", regions: [] },
  { name: "Naples", he: "נאפולי", lat: 40.85, lng: 14.27, kind: "city", country: "Italy", regions: [] },
  { name: "Paris", he: "פריז", lat: 48.86, lng: 2.35, kind: "city", country: "France", regions: [] },
  { name: "Nice", he: "ניס", lat: 43.7, lng: 7.27, kind: "city", country: "France", regions: [] },
  { name: "Barcelona", he: "ברצלונה", lat: 41.39, lng: 2.17, kind: "city", country: "Spain", regions: [] },
  { name: "Madrid", he: "מדריד", lat: 40.42, lng: -3.7, kind: "city", country: "Spain", regions: [] },
  { name: "Seville", he: "סביליה", lat: 37.39, lng: -5.99, kind: "city", country: "Spain", regions: [] },
  { name: "Lisbon", he: "ליסבון", lat: 38.72, lng: -9.14, kind: "city", country: "Portugal", regions: [] },
  { name: "Porto", he: "פורטו", lat: 41.15, lng: -8.61, kind: "city", country: "Portugal", regions: [] },
  { name: "Athens", he: "אתונה", lat: 37.98, lng: 23.73, kind: "city", country: "Greece", regions: [] },
  { name: "London", he: "לונדון", lat: 51.51, lng: -0.13, kind: "city", country: "United Kingdom", regions: [] },
  { name: "Edinburgh", he: "אדינבורו", lat: 55.95, lng: -3.19, kind: "city", country: "United Kingdom", regions: [] },
  { name: "Amsterdam", he: "אמסטרדם", lat: 52.37, lng: 4.9, kind: "city", country: "Netherlands", regions: [] },
  { name: "Berlin", he: "ברלין", lat: 52.52, lng: 13.4, kind: "city", country: "Germany", regions: [] },
  { name: "Munich", he: "מינכן", lat: 48.14, lng: 11.58, kind: "city", country: "Germany", regions: [] },
  { name: "Vienna", he: "וינה", lat: 48.21, lng: 16.37, kind: "city", country: "Austria", regions: [] },
  { name: "Prague", he: "פראג", lat: 50.08, lng: 14.44, kind: "city", country: "Czechia", regions: [] },
  { name: "Budapest", he: "בודפשט", lat: 47.5, lng: 19.04, kind: "city", country: "Hungary", regions: [] },
  { name: "Zurich", he: "ציריך", lat: 47.38, lng: 8.54, kind: "city", country: "Switzerland", regions: [] },
  { name: "Istanbul", he: "איסטנבול", lat: 41.01, lng: 28.98, kind: "city", country: "Turkey", regions: [] },
  { name: "Dubai", he: "דובאי", lat: 25.2, lng: 55.27, kind: "city", country: "UAE", regions: [] },
  { name: "Marrakech", he: "מרקש", lat: 31.63, lng: -8.0, kind: "city", country: "Morocco", regions: [] },
  { name: "Cairo", he: "קהיר", lat: 30.04, lng: 31.24, kind: "city", country: "Egypt", regions: [] },
  { name: "Cape Town", he: "קייפטאון", lat: -33.92, lng: 18.42, kind: "city", country: "South Africa", regions: [] },
  { name: "Tokyo", he: "טוקיו", lat: 35.68, lng: 139.69, kind: "city", country: "Japan", regions: [] },
  { name: "Kyoto", he: "קיוטו", lat: 35.01, lng: 135.77, kind: "city", country: "Japan", regions: [] },
  { name: "Osaka", he: "אוסקה", lat: 34.69, lng: 135.5, kind: "city", country: "Japan", regions: [] },
  { name: "Bangkok", he: "בנגקוק", lat: 13.76, lng: 100.5, kind: "city", country: "Thailand", regions: [] },
  { name: "Singapore", he: "סינגפור", lat: 1.35, lng: 103.82, kind: "city", country: "Singapore", regions: [] },
  { name: "Hanoi", he: "האנוי", lat: 21.03, lng: 105.85, kind: "city", country: "Vietnam", regions: [] },
  { name: "Bali", he: "באלי", lat: -8.41, lng: 115.19, kind: "city", country: "Indonesia", regions: [] },
  { name: "Sydney", he: "סידני", lat: -33.87, lng: 151.21, kind: "city", country: "Australia", regions: [] },
  { name: "Melbourne", he: "מלבורן", lat: -37.81, lng: 144.96, kind: "city", country: "Australia", regions: [] },
  { name: "New York", he: "ניו יורק", lat: 40.71, lng: -74.01, kind: "city", country: "United States", regions: [] },
  { name: "Los Angeles", he: "לוס אנג'לס", lat: 34.05, lng: -118.24, kind: "city", country: "United States", regions: [] },
  { name: "San Francisco", he: "סן פרנסיסקו", lat: 37.77, lng: -122.42, kind: "city", country: "United States", regions: [] },
  { name: "Miami", he: "מיאמי", lat: 25.76, lng: -80.19, kind: "city", country: "United States", regions: [] },
  { name: "Toronto", he: "טורונטו", lat: 43.65, lng: -79.38, kind: "city", country: "Canada", regions: [] },
  { name: "Vancouver", he: "ונקובר", lat: 49.28, lng: -123.12, kind: "city", country: "Canada", regions: [] },
  { name: "Mexico City", he: "מקסיקו סיטי", lat: 19.43, lng: -99.13, kind: "city", country: "Mexico", regions: [] },
  { name: "Buenos Aires", he: "בואנוס איירס", lat: -34.6, lng: -58.38, kind: "city", country: "Argentina", regions: [] },
  { name: "Rio de Janeiro", he: "ריו דה ז'ניירו", lat: -22.91, lng: -43.17, kind: "city", country: "Brazil", regions: [] },
  { name: "Lima", he: "לימה", lat: -12.05, lng: -77.04, kind: "city", country: "Peru", regions: [] },
];

function scopesFor(p: Place): string[] {
  if (p.kind !== "city") return p.regions;
  const c = p.country ?? "";
  return [`${p.name} only`, `${p.name} & around`, `All of ${c}`];
}

const PLACES: Place[] = [
  { name: "Italy", he: "איטליה", lat: 42.5, lng: 12.5, regions: ["All of Italy", "Tuscany", "Rome", "Amalfi", "Dolomites", "Sicily"] },
  { name: "Switzerland", he: "שווייץ", lat: 46.8, lng: 8.2, regions: ["All of Switzerland", "Zermatt", "Interlaken", "Lucerne", "Geneva"] },
  { name: "France", he: "צרפת", lat: 46.6, lng: 2.2, regions: ["All of France", "Paris", "Provence", "Normandy", "Côte d'Azur"] },
  { name: "Spain", he: "ספרד", lat: 40.4, lng: -3.7, regions: ["All of Spain", "Barcelona", "Andalusia", "Madrid", "Basque Country"] },
  { name: "Portugal", he: "פורטוגל", lat: 39.5, lng: -8.0, regions: ["All of Portugal", "Lisbon", "Porto", "Algarve"] },
  { name: "Greece", he: "יוון", lat: 39.0, lng: 22.0, regions: ["All of Greece", "Athens", "Crete", "Santorini", "Peloponnese"] },
  { name: "United Kingdom", he: "בריטניה", lat: 54.0, lng: -2.0, regions: ["London", "Scotland", "Cornwall", "Lake District"] },
  { name: "Iceland", he: "איסלנד", lat: 65.0, lng: -18.0, regions: ["Ring Road", "Reykjavík", "South Coast"] },
  { name: "Norway", he: "נורווגיה", lat: 62.0, lng: 10.0, regions: ["Fjords", "Lofoten", "Oslo", "Bergen"] },
  { name: "Germany", he: "גרמניה", lat: 51.0, lng: 10.0, regions: ["Berlin", "Bavaria", "Black Forest"] },
  { name: "Croatia", he: "קרואטיה", lat: 45.0, lng: 16.0, regions: ["Dalmatian Coast", "Istria", "Dubrovnik"] },
  { name: "Turkey", he: "טורקיה", lat: 39.0, lng: 35.0, regions: ["Istanbul", "Cappadocia", "Turquoise Coast"] },
  { name: "Israel", he: "ישראל", lat: 31.5, lng: 34.8, regions: ["Tel Aviv", "Jerusalem", "Galilee", "Negev"] },
  { name: "Egypt", he: "מצרים", lat: 26.8, lng: 30.8, regions: ["Cairo", "Luxor & Aswan", "Red Sea"] },
  { name: "Morocco", he: "מרוקו", lat: 31.8, lng: -7.0, regions: ["Marrakech", "Fes", "Sahara", "Atlantic Coast"] },
  { name: "Kenya", he: "קניה", lat: 0.5, lng: 37.9, regions: ["Masai Mara", "Nairobi", "Coast"] },
  { name: "South Africa", he: "דרום אפריקה", lat: -29.0, lng: 24.0, regions: ["Cape Town", "Garden Route", "Kruger"] },
  { name: "UAE", he: "איחוד האמירויות", lat: 24.0, lng: 54.0, regions: ["Dubai", "Abu Dhabi"] },
  { name: "India", he: "הודו", lat: 21.0, lng: 78.0, regions: ["Rajasthan", "Kerala", "Goa", "Himalayas"] },
  { name: "Thailand", he: "תאילנד", lat: 15.0, lng: 101.0, regions: ["Bangkok", "Chiang Mai", "Islands"] },
  { name: "Vietnam", he: "וייטנאם", lat: 16.0, lng: 108.0, regions: ["Hanoi & north", "Hoi An", "Ho Chi Minh"] },
  { name: "Japan", he: "יפן", lat: 36.0, lng: 138.0, regions: ["All of Japan", "Tokyo", "Kyoto & Osaka", "Hokkaido", "Okinawa"] },
  { name: "China", he: "סין", lat: 35.0, lng: 104.0, regions: ["Beijing", "Shanghai", "Yunnan"] },
  { name: "Indonesia", he: "אינדונזיה", lat: -2.0, lng: 118.0, regions: ["Bali", "Java", "Komodo"] },
  { name: "Australia", he: "אוסטרליה", lat: -25.0, lng: 134.0, regions: ["Sydney", "Melbourne", "Great Barrier Reef", "Outback"] },
  { name: "New Zealand", he: "ניו זילנד", lat: -41.0, lng: 174.0, regions: ["South Island", "North Island"] },
  { name: "United States", he: "ארצות הברית", lat: 39.0, lng: -98.0, regions: ["New York", "California", "National Parks", "Florida"] },
  { name: "Canada", he: "קנדה", lat: 56.0, lng: -106.0, regions: ["Rockies", "Vancouver", "Quebec"] },
  { name: "Mexico", he: "מקסיקו", lat: 23.0, lng: -102.0, regions: ["Mexico City", "Yucatán", "Oaxaca"] },
  { name: "Peru", he: "פרו", lat: -9.0, lng: -75.0, regions: ["Cusco & Machu Picchu", "Lima", "Amazon"] },
  { name: "Brazil", he: "ברזיל", lat: -10.0, lng: -55.0, regions: ["Rio", "Amazon", "Bahia"] },
  { name: "Argentina", he: "ארגנטינה", lat: -35.0, lng: -65.0, regions: ["Buenos Aires", "Patagonia", "Mendoza"] },
];

// Very coarse continent outlines as [lat, lng] rings.
const LAND: [number, number][][] = [
  // North America
  [[70, -160], [72, -95], [62, -66], [46, -62], [30, -80], [26, -97], [16, -90], [8, -78], [18, -104], [32, -117], [48, -126], [60, -148]],
  // Greenland
  [[83, -40], [78, -20], [70, -23], [60, -44], [69, -54], [78, -70]],
  // South America
  [[11, -74], [6, -52], [-4, -36], [-22, -41], [-38, -60], [-54, -68], [-42, -73], [-18, -71], [-3, -80]],
  // Europe
  [[71, 26], [64, 40], [50, 40], [45, 30], [40, 27], [37, 22], [38, 15], [43, 9], [37, -9], [43, -9], [48, -5], [51, 2], [57, 8], [61, 5], [66, 13]],
  // Africa
  [[37, 10], [31, 32], [12, 44], [-1, 42], [-13, 40], [-27, 33], [-35, 20], [-29, 16], [-6, 12], [5, 8], [4, -8], [15, -17], [22, -17], [35, -6]],
  // Asia
  [[70, 60], [76, 100], [72, 140], [66, 180], [60, 162], [50, 140], [35, 126], [22, 116], [10, 106], [1, 104], [8, 78], [20, 72], [25, 60], [30, 50], [40, 28], [45, 40], [55, 55]],
  // Japan
  [[45, 142], [41, 141], [35, 140], [33, 131], [38, 138], [43, 141]],
  // Australia
  [[-12, 131], [-11, 142], [-25, 153], [-38, 148], [-35, 137], [-32, 116], [-22, 114], [-14, 127]],
  // UK + Ireland
  [[59, -3], [53, 1], [50, -5], [53, -10], [55, -8]],
  // Iceland
  [[66, -23], [66, -15], [64, -14], [63, -22]],
  // New Zealand
  [[-35, 173], [-38, 178], [-46, 170], [-42, 172]],
];

type Rot = { lng: number; lat: number };

function project(lat: number, lng: number, rot: Rot, r: number, cx: number, cy: number) {
  const φ = (lat * Math.PI) / 180;
  const λ = ((lng + rot.lng) * Math.PI) / 180;
  const φ0 = (rot.lat * Math.PI) / 180;
  const cosc = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ);
  const x = cx + r * Math.cos(φ) * Math.sin(λ);
  const y = cy - r * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ));
  return { x, y, visible: cosc > 0, depth: cosc };
}

function normLng(d: number) {
  let v = d;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

function Globe({
  target,
  hovered,
  onHover,
  onPick,
  lang,
}: {
  target: Place | null;
  hovered: Place | null;
  onHover: (p: Place | null) => void;
  onPick: (p: Place) => void;
  lang: "en" | "he";
}) {
  const t = useHostTheme();
  const size = 360;
  const r = 160;
  const cx = size / 2;
  const cy = size / 2;

  const [rot, setRot] = useState<Rot>({ lng: -12, lat: -35 });
  const rotRef = useRef<Rot>(rot);
  const dragRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const idleRef = useRef<number>(Date.now());
  const flyRef = useRef<{ from: Rot; to: Rot; start: number } | null>(null);
  const [flying, setFlying] = useState(false);

  // Fly to the target whenever it changes.
  useEffect(() => {
    if (!target) return;
    const from = rotRef.current;
    const toLng = -target.lng;
    const toLat = -target.lat;
    // shortest way round
    const dl = normLng(toLng - from.lng);
    flyRef.current = { from, to: { lng: from.lng + dl, lat: toLat }, start: performance.now() };
    setFlying(true);
  }, [target]);

  // Animation loop: fly-to easing, otherwise slow idle spin.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const fly = flyRef.current;
      if (fly) {
        const k = Math.min(1, (now - fly.start) / 1400);
        const e = 1 - Math.pow(1 - k, 3);
        rotRef.current = { lng: fly.from.lng + (fly.to.lng - fly.from.lng) * e, lat: fly.from.lat + (fly.to.lat - fly.from.lat) * e };
        setRot(rotRef.current);
        if (k >= 1) {
          flyRef.current = null;
          setFlying(false);
          idleRef.current = Date.now();
        }
      } else if (!dragRef.current.active && !target && Date.now() - idleRef.current > 1500) {
        rotRef.current = { ...rotRef.current, lng: rotRef.current.lng + 0.12 };
        setRot(rotRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const onDown = (e: { clientX: number; clientY: number }) => {
    dragRef.current = { x: e.clientX, y: e.clientY, active: true };
    flyRef.current = null;
    setFlying(false);
  };
  const onMove = (e: { clientX: number; clientY: number }) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY };
    rotRef.current = {
      lng: rotRef.current.lng + dx * 0.45,
      lat: Math.max(-75, Math.min(75, rotRef.current.lat - dy * 0.45)),
    };
    idleRef.current = Date.now();
    setRot(rotRef.current);
  };
  const onUp = () => {
    dragRef.current = { ...dragRef.current, active: false };
    idleRef.current = Date.now();
  };
  const onWheel = (e: { deltaY: number; deltaX: number }) => {
    flyRef.current = null;
    rotRef.current = { ...rotRef.current, lng: rotRef.current.lng + (e.deltaY + e.deltaX) * 0.25 };
    idleRef.current = Date.now();
    setRot(rotRef.current);
  };

  const land = LAND.map((ring) => ring.map(([la, lo]) => project(la, lo, rot, r, cx, cy)).filter((p) => p.visible));
  const meridians: string[] = [];
  for (let lo = -180; lo < 180; lo += 30) {
    const pts: string[] = [];
    for (let la = -90; la <= 90; la += 5) {
      const p = project(la, lo, rot, r, cx, cy);
      if (p.visible) pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      else if (pts.length) break;
    }
    if (pts.length > 1) meridians.push(pts.join(" "));
  }
  const parallels: string[] = [];
  for (let la = -60; la <= 60; la += 30) {
    const segs: string[][] = [[]];
    for (let lo = -180; lo <= 180; lo += 5) {
      const p = project(la, lo, rot, r, cx, cy);
      if (p.visible) segs[segs.length - 1].push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      else if (segs[segs.length - 1].length) segs.push([]);
    }
    segs.filter((s) => s.length > 1).forEach((s) => parallels.push(s.join(" ")));
  }

  const focus = hovered ?? target;

  return (
    <Stack gap={6}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Interactive globe"
        style={{ cursor: dragRef.current.active ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onWheel={onWheel}
      >
        <defs>
          <clipPath id="globe-clip">
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={t.fill.quaternary} stroke={t.stroke.primary} />
        <g clipPath="url(#globe-clip)">
          {meridians.map((d, i) => (
            <polyline key={`m${i}`} points={d} fill="none" stroke={t.stroke.secondary} strokeWidth={0.8} />
          ))}
          {parallels.map((d, i) => (
            <polyline key={`p${i}`} points={d} fill="none" stroke={t.stroke.secondary} strokeWidth={0.8} />
          ))}
          {land.map((ring, i) =>
            ring.length >= 3 ? (
              <polygon
                key={`l${i}`}
                points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                fill={t.fill.secondary}
                stroke={t.stroke.primary}
                strokeWidth={0.6}
              />
            ) : null,
          )}
          {target?.kind === "city" && (() => {
            const q = project(target.lat, target.lng, rot, r, cx, cy);
            if (!q.visible) return null;
            return (
              <g>
                <circle cx={q.x} cy={q.y} r={14} fill="none" stroke={t.accent.primary} strokeWidth={1.5} opacity={0.6} />
                <circle cx={q.x} cy={q.y} r={5} fill={t.accent.primary} stroke={t.bg.editor} strokeWidth={1.5} />
              </g>
            );
          })()}
          {PLACES.map((p) => {
            const q = project(p.lat, p.lng, rot, r, cx, cy);
            if (!q.visible) return null;
            const isFocus = focus?.name === p.name;
            const isTarget = target?.name === p.name || (target?.kind === "city" && target.country === p.name);
            return (
              <g
                key={p.name}
                onPointerEnter={() => onHover(p)}
                onPointerLeave={() => onHover(null)}
                onClick={() => onPick(p)}
                style={{ cursor: "pointer" }}
              >
                <circle cx={q.x} cy={q.y} r={isFocus ? 7 : 4.5} fill={isTarget ? t.accent.primary : isFocus ? t.text.primary : t.text.tertiary} opacity={0.35 + 0.65 * q.depth} />
                {isTarget && <circle cx={q.x} cy={q.y} r={12} fill="none" stroke={t.accent.primary} strokeWidth={1.5} opacity={0.6} />}
              </g>
            );
          })}
        </g>
        {focus && (() => {
          const q = project(focus.lat, focus.lng, rot, r, cx, cy);
          if (!q.visible) return null;
          const label = (lang === "he" ? focus.he : focus.name) + (focus.kind === "city" && focus.country ? ` · ${focus.country}` : "");
          const w = Math.max(44, label.length * 7 + 16);
          const x = Math.min(size - w - 4, Math.max(4, q.x + 12));
          const y = Math.max(4, q.y - 30);
          return (
            <g>
              <rect x={x} y={y} width={w} height={22} rx={4} fill={t.bg.elevated} stroke={t.stroke.primary} />
              <text x={x + w / 2} y={y + 15} textAnchor="middle" fontSize={11} fill={t.text.primary}>
                {label}
              </text>
            </g>
          );
        })()}
      </svg>
      <Text size="small" tone="quaternary">
        {flying ? "Flying to destination…" : target ? `Centered on ${lang === "he" ? target.he : target.name} · drag or scroll to spin` : "Drag or scroll to spin · hover a dot · click to pick"}
      </Text>
    </Stack>
  );
}

function HomeScreen({
  lang,
  onLang,
  signedIn,
  onSignIn,
  onStartPlan,
}: {
  lang: "en" | "he";
  onLang: (l: "en" | "he") => void;
  signedIn: boolean;
  onSignIn: () => void;
  onStartPlan: (destination: string) => void;
}) {
  const t = useHostTheme();
  const he = lang === "he";
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Place | null>(null);
  const [hovered, setHovered] = useState<Place | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);

  // Auth gate: the only way into planning. If the user is signed out we park
  // the chosen destination, show the sign-in step, and continue afterwards.
  const startPlanning = (destination: string) => {
    if (!signedIn) {
      setPendingDestination(destination);
      return;
    }
    onStartPlan(destination);
  };
  const completeSignIn = () => {
    onSignIn();
    if (pendingDestination) {
      const d = pendingDestination;
      setPendingDestination(null);
      onStartPlan(d);
    }
  };

  const q = query.trim().toLowerCase();
  const searchable = [...PLACES, ...CITIES];
  const matches = q.length
    ? searchable
        .filter((p) => p.name.toLowerCase().includes(q) || p.he.includes(query.trim()) || (p.country ?? "").toLowerCase().startsWith(q))
        .sort((a, b) => {
          const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          return as - bs || a.name.localeCompare(b.name);
        })
        .slice(0, 7)
    : [];

  const pick = (p: Place) => {
    setTarget(p);
    const scopes = scopesFor(p);
    setRegion(p.kind === "city" ? scopes[0] : scopes[1] ?? scopes[0]);
    setQuery("");
  };
  const onQuery = (v: string) => {
    setQuery(v);
    const exact = searchable.find((p) => p.name.toLowerCase() === v.trim().toLowerCase() || p.he === v.trim());
    if (exact) pick(exact);
  };

  return (
    <Frame url="wayfare.app" dir={he ? "rtl" : "ltr"}>
      <TopNav signedIn={signedIn} tier={signedIn ? "Free" : undefined} lang={lang} onLang={onLang} onSignIn={onSignIn} />
      <Grid columns="1fr 380px" gap={24} align="start">
        <Stack gap={12}>
          {pendingDestination && (
            <SignInGate
              destination={pendingDestination}
              lang={lang}
              onSignedIn={completeSignIn}
              onCancel={() => setPendingDestination(null)}
            />
          )}
          <div style={{ fontSize: 22, fontWeight: 590, color: t.text.primary, lineHeight: "28px" }}>
            {he ? "לאן נוסעים?" : "Where to?"}
          </div>
          <Text tone="secondary">
            {he
              ? "סובבו את הגלובוס ולחצו על מדינה, או חפשו עיר או אזור."
              : "Spin the globe and click a country, or search for a city or region."}
          </Text>
          <TextInput
            value={query}
            onChange={onQuery}
            placeholder={he ? "חיפוש: תל אביב, טוסקנה, יפן…" : "Search a city, region or country: Tel Aviv, Tuscany, Japan…"}
            type="search"
          />
          {matches.length > 0 && (
            <Row gap={6} wrap>
              {matches.map((p) => (
                <Pill
                  key={`${p.kind ?? "country"}-${p.name}`}
                  size="sm"
                  onClick={() => pick(p)}
                  leadingContent={
                    <span style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7 }}>{p.kind === "city" ? "CITY" : "COUNTRY"}</span>
                  }
                >
                  {he ? p.he : p.name}
                  {p.kind === "city" && p.country ? ` · ${p.country}` : ""}
                </Pill>
              ))}
            </Row>
          )}
          {q.length > 1 && matches.length === 0 && (
            <Text size="small" tone="tertiary">
              Not in our list yet — in the real app this falls through to Nominatim and offers "{query.trim()}" as a new destination.
            </Text>
          )}
          {matches.length === 0 && (
            <Row gap={6} wrap>
              {["Italy", "Switzerland", "Japan", "Portugal", "Greece"].map((c) => {
                const p = PLACES.find((x) => x.name === c)!;
                return (
                  <Pill key={c} size="sm" active={target?.name === c} onClick={() => pick(p)}>
                    {he ? p.he : p.name}
                  </Pill>
                );
              })}
            </Row>
          )}
          <Divider />
          {target ? (
            <Card>
              <CardHeader trailing={<Pill size="sm">popover</Pill>}>
                {he ? `מתכננים טיול ל${target.he}?` : `Plan a trip to ${target.name}?`}
              </CardHeader>
              <CardBody>
                <Stack gap={10}>
                  <Text size="small" tone="secondary">
                    {he
                      ? "בחרו עיר, אזור או את כל המדינה. כדי להתחיל, נבקש התחברות עם Google."
                      : target.kind === "city"
                        ? "Just the city, the city plus day trips, or the whole country. You'll sign in with Google to start."
                        : "Pick the whole country or one region. You'll sign in with Google to start."}
                  </Text>
                  <Row gap={6} wrap>
                    {scopesFor(target).map((c) => (
                      <Pill key={c} size="sm" active={c === region} onClick={() => setRegion(c)}>
                        {c}
                      </Pill>
                    ))}
                  </Row>
                  {target.kind === "city" && (
                    <Text size="small" tone="quaternary">
                      "{target.name} & around" adds day trips within ~1.5 h; "All of {target.country}" plans a multi-city route.
                    </Text>
                  )}
                  <Row gap={8}>
                    <Button variant="primary" onClick={() => startPlanning(region ?? target.name)}>
                      {he ? `כן, בואו נתכנן ${region ?? ""}` : `Yes, let's plan ${region ?? target.name}`}
                    </Button>
                    <Button variant="ghost" onClick={() => setTarget(null)}>
                      {he ? "לא עכשיו" : "Not now"}
                    </Button>
                  </Row>
                </Stack>
              </CardBody>
            </Card>
          ) : (
            <Callout tone="neutral">
              {he
                ? "לחצו על נקודה בגלובוס או חפשו מדינה — הגלובוס יסתובב ויתמקד בה ואז ייפתח החלון."
                : "Click a dot on the globe or search a country — the globe flies to it, then the popover opens."}
            </Callout>
          )}
          <Note>
            Real build: MapLibre GL globe projection with Natural Earth borders (whole country polygons highlight on
            hover), inertia on drag, and `flyTo` for search. Search resolves against the destination registry
            first, then Nominatim. Auth gate: the client redirects to Google sign-in and the Worker independently
            rejects any plan request without a valid Firebase ID token — the redirect is UX, the token check is
            the security.
          </Note>
        </Stack>
        <Globe target={target} hovered={hovered} onHover={setHovered} onPick={pick} lang={lang} />
      </Grid>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — Trip Brief (wizard)
// ---------------------------------------------------------------------------

const BRIEF_STEPS = ["Dates & flights", "Who & how", "Pace", "What you love", "Must-visits", "Review"];

/**
 * A category group with fixed options plus user-typed custom entries.
 * Custom entries render as pills tagged "custom", are removable, and count
 * toward the same free-tier limit as the built-in options.
 */
function CategoryPicker({
  options,
  selected,
  custom,
  max,
  placeholder,
  onToggle,
  onAddCustom,
  onRemoveCustom,
  small,
}: {
  options: string[];
  selected: string[];
  custom: string[];
  max: number;
  placeholder: string;
  onToggle: (o: string) => void;
  onAddCustom: (v: string) => void;
  onRemoveCustom: (v: string) => void;
  small?: boolean;
}) {
  const t = useHostTheme();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const used = selected.length + custom.length;
  const full = used >= max;
  const commit = () => {
    const v = draft.trim();
    if (v) onAddCustom(v);
    setDraft("");
    setAdding(false);
  };
  return (
    <Stack gap={8}>
      <Row gap={6} wrap>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <Pill key={o} size={small ? "sm" : "md"} active={on} disabled={!on && full} onClick={() => onToggle(o)}>
              {o}
            </Pill>
          );
        })}
        {custom.map((c) => (
          <Pill
            key={`c-${c}`}
            size={small ? "sm" : "md"}
            active
            title="Custom — you typed this"
            onClick={() => onRemoveCustom(c)}
            leadingContent={
              <span style={{ fontSize: 9, color: t.text.onAccent, opacity: 0.8, letterSpacing: 0.4 }}>CUSTOM</span>
            }
          >
            {c} ×
          </Pill>
        ))}
        {!adding && (
          <Pill
            size={small ? "sm" : "md"}
            disabled={full}
            onClick={() => setAdding(true)}
            style={{ borderStyle: "dashed" }}
          >
            + Add your own
          </Pill>
        )}
      </Row>
      {adding && (
        <Row gap={8} align="center">
          <TextInput value={draft} onChange={setDraft} placeholder={placeholder} style={{ maxWidth: 320 }} />
          <Button variant="primary" onClick={commit} disabled={!draft.trim()}>
            Add
          </Button>
          <Button variant="ghost" onClick={() => { setAdding(false); setDraft(""); }}>
            Cancel
          </Button>
        </Row>
      )}
    </Stack>
  );
}

// --- Step 4: "What you love" — the step the planner reads most closely ------

const VACATION_TYPES: { name: string; blurb: string }[] = [
  { name: "Foodie", blurb: "markets, trattorie, the one meal you'll remember" },
  { name: "Wine & vineyards", blurb: "tastings, cellar tours, a view over the vines" },
  { name: "Culture & museums", blurb: "galleries, collections, the big names" },
  { name: "History & landmarks", blurb: "old towns, ruins, castles, cathedrals" },
  { name: "Nature & outdoors", blurb: "hikes, viewpoints, gardens, lakes" },
  { name: "Beach & relax", blurb: "sea, pool, slow afternoons" },
  { name: "Local life & hidden gems", blurb: "neighbourhoods, small places, few tourists" },
  { name: "Romance", blurb: "sunsets, quiet dinners, unhurried" },
  { name: "Family fun", blurb: "kid-friendly, short hops, playgrounds" },
  { name: "Adventure & sport", blurb: "bikes, kayaks, climbs, tours" },
  { name: "Wellness & spa", blurb: "thermal baths, massages, rest" },
  { name: "Shopping", blurb: "boutiques, outlets, markets" },
  { name: "Nightlife", blurb: "bars, live music, late dinners" },
  { name: "Photo spots", blurb: "the views and streets people post" },
  { name: "Festivals & events", blurb: "what's on while you're there" },
];

const SUGGESTED_INTERESTS_TUSCANY = [
  "gelato",
  "truffle hunting",
  "Chianti tasting",
  "cooking class",
  "Renaissance art",
  "thermal baths",
  "Vespa tour",
  "street food",
  "hill-town walks",
  "leather & artisans",
  "cycling",
  "olive oil",
];

function WhatYouLoveStep({
  mix,
  mixCustom,
  interests,
  interestsCustom,
  onToggleMix,
  onAddMixCustom,
  onRemoveMixCustom,
  onToggleInterest,
  onAddInterestCustom,
  onRemoveInterestCustom,
  mixCap,
  interestCap,
  onContinue,
  onBack,
}: {
  mix: string[];
  mixCustom: string[];
  interests: string[];
  interestsCustom: string[];
  onToggleMix: (o: string) => void;
  onAddMixCustom: (v: string) => void;
  onRemoveMixCustom: (v: string) => void;
  onToggleInterest: (o: string) => void;
  onAddInterestCustom: (v: string) => void;
  onRemoveInterestCustom: (v: string) => void;
  mixCap: number;
  interestCap: number;
  onContinue: () => void;
  onBack: () => void;
}) {
  const t = useHostTheme();
  const [mustHave, setMustHave] = useState("one great meal a day we'll still talk about");
  const [avoid, setAvoid] = useState("long museum days, tourist-trap restaurants");
  const [perfectDay, setPerfectDay] = useState("slow morning, a hill town, a wine tasting with a view, early dinner");
  const [interestDraft, setInterestDraft] = useState("");
  const BRIEF_CAP = 300;
  const briefUsed = mustHave.length + avoid.length + perfectDay.length;

  const mixUsed = mix.length + mixCustom.length;
  const interestsUsed = interests.length + interestsCustom.length;
  const mixFull = mixUsed >= mixCap;
  const interestsFull = interestsUsed >= interestCap;

  const orderedMix = [...mix, ...mixCustom];
  const allInterests = [...interests, ...interestsCustom];

  const preview = [
    orderedMix.length
      ? `A trip that is mostly about ${orderedMix[0].toLowerCase()}${orderedMix[1] ? `, with ${orderedMix.slice(1).join(" and ").toLowerCase()} on the side` : ""}.`
      : "Pick at least one vacation type to shape the trip.",
    allInterests.length ? `You care about ${allInterests.join(", ")}.` : "",
    mustHave.trim() ? `It must have ${mustHave.trim()}.` : "",
    avoid.trim() ? `Avoid ${avoid.trim()}.` : "",
    perfectDay.trim() ? `A perfect day looks like: ${perfectDay.trim()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const addInterest = () => {
    const v = interestDraft.trim();
    if (!v || interestsFull) return;
    if (SUGGESTED_INTERESTS_TUSCANY.includes(v)) onToggleInterest(v);
    else onAddInterestCustom(v);
    setInterestDraft("");
  };

  const card = (selected: boolean, disabled: boolean): CSSProperties => ({
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${selected ? t.accent.primary : t.stroke.secondary}`,
    background: selected ? t.fill.quaternary : "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    minWidth: 0,
  });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <Stack gap={22}>
        {/* progress + headline */}
        <Stack gap={6}>
          <Row gap={8} align="center">
            <Text size="small" tone="tertiary">Step 4 of 6</Text>
            <div style={{ flex: 1, height: 2, background: t.fill.tertiary, borderRadius: 1 }}>
              <div style={{ width: "66%", height: 2, background: t.accent.primary, borderRadius: 1 }} />
            </div>
          </Row>
          <div style={{ fontSize: 24, fontWeight: 590, lineHeight: "30px", color: t.text.primary, marginTop: 6 }}>
            What makes a trip great for you?
          </div>
          <Text tone="secondary">
            This is the part the planner reads most closely. A few honest words beat a long list.
          </Text>
        </Stack>

        {/* 1. vacation types */}
        <Stack gap={10}>
          <Row gap={8} align="center">
            <Text weight="semibold">The kind of trip</Text>
            <Spacer />
            <Text size="small" tone="tertiary">
              {mixUsed} of {mixCap} · first pick = mostly, second = also
            </Text>
          </Row>
          <Grid columns={3} gap={8}>
            {VACATION_TYPES.map((v) => {
              const i = mix.indexOf(v.name);
              const selected = i >= 0;
              const disabled = !selected && mixFull;
              return (
                <div key={v.name} style={card(selected, disabled)} onClick={() => !disabled && onToggleMix(v.name)}>
                  <Row gap={6} align="center">
                    <Text weight="medium" size="small" truncate>{v.name}</Text>
                    <Spacer />
                    {selected && <Pill size="sm" active>{i === 0 ? "mostly" : "also"}</Pill>}
                  </Row>
                  <Text size="small" tone="tertiary">{v.blurb}</Text>
                </div>
              );
            })}
            {mixCustom.map((c) => (
              <div key={`c-${c}`} style={card(true, false)} onClick={() => onRemoveMixCustom(c)}>
                <Row gap={6} align="center">
                  <Text weight="medium" size="small" truncate>{c}</Text>
                  <Spacer />
                  <Pill size="sm" active>{mix.length === 0 ? "mostly" : "also"}</Pill>
                </Row>
                <Text size="small" tone="tertiary">your own · click to remove</Text>
              </div>
            ))}
            <CustomTypeCard disabled={mixFull} onAdd={onAddMixCustom} />
          </Grid>
        </Stack>

        {/* 2. interests */}
        <Stack gap={10}>
          <Row gap={8} align="center">
            <Text weight="semibold">Things you'd go out of your way for</Text>
            <Spacer />
            <Text size="small" tone="tertiary">{interestsUsed} of {interestCap}</Text>
          </Row>
          <Row gap={8} align="center">
            <TextInput
              value={interestDraft}
              onChange={setInterestDraft}
              placeholder={interestsFull ? "You've used your 3 — remove one to add another" : "Type anything — e.g. truffle hunting, a specific pastry, vintage Vespas…"}
              disabled={interestsFull}
              style={{ flex: 1 }}
            />
            <Button variant="primary" onClick={addInterest} disabled={!interestDraft.trim() || interestsFull}>Add</Button>
          </Row>
          {allInterests.length > 0 && (
            <Row gap={6} wrap>
              {interests.map((p) => (
                <Pill key={p} active onClick={() => onToggleInterest(p)} title="Click to remove">{p} ×</Pill>
              ))}
              {interestsCustom.map((p) => (
                <Pill
                  key={`c-${p}`}
                  active
                  onClick={() => onRemoveInterestCustom(p)}
                  title="Your own — click to remove"
                  leadingContent={<span style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.8 }}>YOURS</span>}
                >
                  {p} ×
                </Pill>
              ))}
            </Row>
          )}
          <Stack gap={6}>
            <Text size="small" tone="tertiary">Popular in Tuscany</Text>
            <Row gap={6} wrap>
              {SUGGESTED_INTERESTS_TUSCANY.filter((s) => !interests.includes(s)).map((s) => (
                <Pill key={s} size="sm" disabled={interestsFull} onClick={() => !interestsFull && onToggleInterest(s)}>
                  + {s}
                </Pill>
              ))}
            </Row>
          </Stack>
        </Stack>

        {/* 3. guided brief */}
        <Stack gap={10}>
          <Row gap={8} align="center">
            <Text weight="semibold">In your words</Text>
            <Spacer />
            <Text size="small" tone={briefUsed > BRIEF_CAP ? "primary" : "tertiary"}>
              {briefUsed} / {BRIEF_CAP} characters
            </Text>
          </Row>
          <GuidedField label="This trip must have…" hint="the non-negotiable" value={mustHave} onChange={setMustHave} placeholder="e.g. one great meal a day, a sunset over vineyards" />
          <GuidedField label="Please avoid…" hint="what would ruin it" value={avoid} onChange={setAvoid} placeholder="e.g. long museum days, queues, driving after dark" />
          <GuidedField label="A perfect day looks like…" hint="rhythm, not a list" value={perfectDay} onChange={setPerfectDay} placeholder="e.g. slow morning, one town, a long lunch, early dinner" />
        </Stack>

        {/* 4. live readback */}
        <div style={{ borderLeft: `2px solid ${t.accent.primary}`, padding: "8px 14px", background: t.fill.quaternary, borderRadius: 4 }}>
          <Text size="small" tone="tertiary" weight="medium">How the planner will read this</Text>
          <Text style={{ marginTop: 4 }}>{preview}</Text>
        </div>

        <Row gap={8} align="center">
          <Button variant="primary" onClick={onContinue} disabled={orderedMix.length === 0}>Continue to must-visits</Button>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Spacer />
          <Text size="small" tone="quaternary">Saved automatically · you can come back to this</Text>
        </Row>
      </Stack>
    </div>
  );
}

function CustomTypeCard({ disabled, onAdd }: { disabled: boolean; onAdd: (v: string) => void }) {
  const t = useHostTheme();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (open) {
    return (
      <div style={{ padding: "10px 12px", borderRadius: 8, border: `1px dashed ${t.stroke.primary}` }}>
        <Stack gap={6}>
          <TextInput value={v} onChange={setV} placeholder="e.g. Motorsport, Pilgrimage" />
          <Row gap={6}>
            <Button variant="primary" disabled={!v.trim()} onClick={() => { onAdd(v.trim()); setV(""); setOpen(false); }}>Add</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setV(""); }}>Cancel</Button>
          </Row>
        </Stack>
      </div>
    );
  }
  return (
    <div
      onClick={() => !disabled && setOpen(true)}
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px dashed ${t.stroke.primary}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text weight="medium" size="small">+ Something else</Text>
      <Text size="small" tone="tertiary">name it in your own words</Text>
    </div>
  );
}

function GuidedField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Stack gap={4}>
      <Row gap={8} align="center">
        <Text size="small" weight="medium">{label}</Text>
        <Text size="small" tone="quaternary">{hint}</Text>
      </Row>
      <TextInput value={value} onChange={onChange} placeholder={placeholder} />
    </Stack>
  );
}

function LimitMeter({ used, max, label }: { used: number; max: number; label: string }) {
  return (
    <UsageBar
      total={max}
      topLeftLabel={label}
      topRightLabel={`${used} / ${max} on Free`}
      segments={[{ id: "u", value: used, color: used >= max ? "orange" : "blue" }]}
    />
  );
}

function BriefScreen() {
  const t = useHostTheme();
  const [step, setStep] = useCanvasState<number>("briefStep", 3);
  const [pace, setPace] = useCanvasState<string>("pace", "Balanced");
  const [mix, setMix] = useState<string[]>(["Foodie", "Wine & vineyards"]);
  const [mixCustom, setMixCustom] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>(["gelato", "truffle hunting"]);
  const [interestsCustom, setInterestsCustom] = useState<string[]>(["that pistachio gelato place in Siena"]);
  const toggle = (list: string[], set: (v: string[]) => void, cap: number, customCount: number) => (o: string) => {
    if (list.includes(o)) set(list.filter((x) => x !== o));
    else if (list.length + customCount < cap) set([...list, o]);
  };
  const MIX_CAP = 2;
  const INTEREST_CAP = 3;
  const [trustHours, setTrustHours] = useState(false);
  const [carOk, setCarOk] = useState(true);
  const [days, setDays] = useState<{ date: string; start: string; end: string; note: string }[]>([
    { date: "Tue 12 May", start: "13:00", end: "21:00", note: "arrival 11:40 FLR" },
    { date: "Wed 13 May", start: "10:00", end: "21:00", note: "" },
    { date: "Thu 14 May", start: "06:00", end: "20:00", note: "sunrise at Val d'Orcia" },
    { date: "Fri 15 May", start: "10:00", end: "21:00", note: "" },
    { date: "Sat 16 May", start: "10:00", end: "21:00", note: "" },
    { date: "Sun 17 May", start: "11:00", end: "23:00", note: "late dinner" },
    { date: "Mon 18 May", start: "09:00", end: "15:30", note: "departure 18:30 PSA" },
  ]);
  const setDay = (i: number, key: "start" | "end", v: string) =>
    setDays(days.map((d, j) => (j === i ? { ...d, [key]: v } : d)));
  const [notes, setNotes] = useState<{ kind: string; text: string }[]>([
    {
      kind: "optimisation",
      text: "We'll rent a car, but optimise it — don't leave it parked a whole day in Florence. Picking up in one place and returning in another is fine.",
    },
  ]);
  const [noteDraft, setNoteDraft] = useState("");
  return (
    <Frame url="wayfare.app/plan/new · Tuscany">
      <TopNav signedIn tier="Free" lang="en" onLang={() => undefined} />
      <Row gap={6} wrap style={{ marginBottom: 14 }}>
        {BRIEF_STEPS.map((s, i) => (
          <Pill key={s} size="sm" active={i === step} onClick={() => setStep(i)}>
            {i + 1}. {s}
          </Pill>
        ))}
      </Row>
      {step === 3 ? (
        <WhatYouLoveStep
          mix={mix}
          mixCustom={mixCustom}
          interests={interests}
          interestsCustom={interestsCustom}
          onToggleMix={toggle(mix, setMix, MIX_CAP, mixCustom.length)}
          onAddMixCustom={(v) => mix.length + mixCustom.length < MIX_CAP && setMixCustom([...mixCustom, v])}
          onRemoveMixCustom={(v) => setMixCustom(mixCustom.filter((x) => x !== v))}
          onToggleInterest={toggle(interests, setInterests, INTEREST_CAP, interestsCustom.length)}
          onAddInterestCustom={(v) => interests.length + interestsCustom.length < INTEREST_CAP && setInterestsCustom([...interestsCustom, v])}
          onRemoveInterestCustom={(v) => setInterestsCustom(interestsCustom.filter((x) => x !== v))}
          mixCap={MIX_CAP}
          interestCap={INTEREST_CAP}
          onContinue={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      ) : (
      <Grid columns="1fr 300px" gap={20} align="start">
        <Stack gap={14}>
          {step === 0 && (
            <Stack gap={10}>
              <H3>Dates & flights</H3>
              <Grid columns={2} gap={10}>
                <Field label="Trip dates">
                  <TextInput value="12 May → 18 May 2027 (6 nights)" />
                </Field>
                <Field label="Arrival · day 1">
                  <TextInput value="FLR Florence · lands 11:40" />
                </Field>
                <Field label="Departure · last day">
                  <TextInput value="PSA Pisa · departs 18:30" />
                </Field>
                <Field label="Output language">
                  <Select
                    value="en"
                    options={[
                      { value: "en", label: "English" },
                      { value: "he", label: "עברית" },
                    ]}
                  />
                </Field>
              </Grid>
              <Note>Flights are inputs only — the plan anchors day 1 and the last day around them.</Note>
            </Stack>
          )}
          {step === 1 && (
            <Stack gap={10}>
              <H3>Who is going, and how you'll move</H3>
              <Field label="Party">
                <Row gap={6} wrap>
                  {["Solo", "Couple", "Family", "Friends", "Multi-generation"].map((p) => (
                    <Pill key={p} active={p === "Couple"}>
                      {p}
                    </Pill>
                  ))}
                  <Pill style={{ borderStyle: "dashed" }}>+ Other (e.g. bachelor party, company retreat)</Pill>
                </Row>
              </Field>
              <Field label="Getting around">
                <Row gap={6} wrap>
                  {["Rental car", "Public transport", "Walk + taxi", "Mixed"].map((p) => (
                    <Pill key={p} active={carOk ? p === "Rental car" : p === "Public transport"} onClick={() => setCarOk(p === "Rental car" || p === "Mixed")}>
                      {p}
                    </Pill>
                  ))}
                  <Pill style={{ borderStyle: "dashed" }}>+ Other (e.g. motorbike, camper van)</Pill>
                </Row>
                <Row gap={8} align="center" style={{ marginTop: 6 }}>
                  <Toggle checked={carOk} onChange={setCarOk} size="sm" />
                  <Text size="small" tone="secondary">
                    I'm OK renting a car if it makes the trip better {carOk ? "· the planner may build road-trip days and moving bases" : "· the planner will keep everything reachable by train, bus and foot"}
                  </Text>
                </Row>
              </Field>
              <Field label="Budget">
                <Row gap={8} align="center" wrap>
                  {[
                    ["€", "budget · trattorie, hostels/B&Bs, free sights"],
                    ["€€", "comfortable · good restaurants, 3–4★ or agriturismo"],
                    ["€€€", "luxury · fine dining, top hotels, private tours"],
                  ].map(([p, d]) => (
                    <Pill key={p} active={p === "€€"} title={d}>
                      {p}
                    </Pill>
                  ))}
                  <Text size="small" tone="tertiary">€€ · roughly €150–250 per day for two, excluding your stay</Text>
                </Row>
                <Row gap={8} align="center" style={{ marginTop: 6 }}>
                  <TextInput placeholder="Optional: total budget, e.g. €3,000 for the week" style={{ maxWidth: 320 }} />
                  <Text size="small" tone="quaternary">the planner will keep stays + activities + meals inside it</Text>
                </Row>
              </Field>
              <Grid columns={1} gap={10}>
                <Field label="Diet & accessibility">
                  <Row gap={6} wrap>
                    <Pill size="sm" active>
                      Vegetarian
                    </Pill>
                    <Pill size="sm">Kosher</Pill>
                    <Pill size="sm">Gluten-free</Pill>
                    <Pill size="sm">Limited walking</Pill>
                    <Pill size="sm" active leadingContent={<span style={{ fontSize: 9, letterSpacing: 0.4 }}>CUSTOM</span>}>
                      nut allergy ×
                    </Pill>
                    <Pill size="sm" style={{ borderStyle: "dashed" }}>+ Add your own</Pill>
                  </Row>
                </Field>
              </Grid>
              <Field label="Where you sleep">
                <Row gap={6} wrap>
                  {["Hotel", "B&B", "Airbnb", "Agriturismo"].map((p) => (
                    <Pill key={p} size="sm" active={p === "Agriturismo"}>
                      {p}
                    </Pill>
                  ))}
                  <Pill size="sm" style={{ borderStyle: "dashed" }}>+ Other</Pill>
                  <Text size="small" tone="tertiary">
                    ·
                  </Text>
                  <Pill size="sm" active>
                    Happy to move bases
                  </Pill>
                  <Pill size="sm">One base only</Pill>
                </Row>
              </Field>
            </Stack>
          )}
          {step === 2 && (
            <Stack gap={12}>
              <H3>Pace and your day</H3>
              <Row gap={8}>
                {[
                  ["Chill", "≈5 active hours · 2 areas"],
                  ["Balanced", "≈7 active hours · up to 4 areas"],
                  ["Packed", "≈9.5 active hours · up to 6 areas"],
                ].map(([p, d]) => (
                  <div
                    key={p}
                    onClick={() => setPace(p)}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 6,
                      cursor: "pointer",
                      border: `1px solid ${p === pace ? t.accent.primary : t.stroke.secondary}`,
                      background: p === pace ? t.fill.quaternary : "transparent",
                    }}
                  >
                    <Text weight="semibold">{p}</Text>
                    <Text size="small" tone="tertiary">
                      {d}
                    </Text>
                  </div>
                ))}
              </Row>
              <Row gap={10} align="center" style={{ padding: "10px 12px", border: `1px solid ${t.stroke.secondary}`, borderRadius: 6 }}>
                <Stack gap={2}>
                  <Text weight="medium" size="small">Let the planner set my hours</Text>
                  <Text size="small" tone="tertiary">It picks each day's start and end from your pace, daylight, opening hours and flights. You can still edit them later.</Text>
                </Stack>
                <Spacer />
                <Toggle checked={trustHours} onChange={setTrustHours} />
              </Row>
              <Grid columns={2} gap={10}>
                <Field label="Default day window">
                  <TextInput value="10:00 → 21:00" disabled={trustHours} />
                </Field>
                <Field label="Rest block">
                  <Row gap={8} align="center">
                    <Toggle checked />
                    <Text size="small" tone="secondary">
                      Long lunch / siesta on Chill & Balanced
                    </Text>
                  </Row>
                </Field>
              </Grid>
              <Field label="Per-date overrides">
                <Table
                  headers={["Date", "Start", "End", "Note"]}
                  rows={[
                    ["Thu 14 May", "06:00", "20:00", "Sunrise at Val d'Orcia"],
                    ["Sun 17 May", "11:00", "23:00", "Late dinner"],
                  ]}
                />
                <Row gap={8} style={{ marginTop: 6 }}>
                  <Button variant="ghost">+ Add a date</Button>
                  <Pill size="sm">Plus feature</Pill>
                </Row>
              </Field>
            </Stack>
          )}
          {step === 4 && (
            <Stack gap={12}>
              <H3>Must-visit places</H3>
              <Text size="small" tone="secondary">
                The plan will always include these — or tell you exactly why one can't fit.
              </Text>
              <TextInput placeholder="Type a place… e.g. Uffizi, Antinori nel Chianti Classico" type="search" />
              <Table
                headers={["Place", "Matched", "Category", ""]}
                rows={[
                  ["Uffizi Gallery", "Menu · Florence", "culture.museum", <Button variant="ghost">Remove</Button>],
                  ["Antinori nel Chianti Classico", "Menu · Chianti", "food.wine", <Button variant="ghost">Remove</Button>],
                  [
                    "That pistachio gelato place in Siena",
                    "Web-verified · La Vecchia Latteria",
                    "food.dessert",
                    <Button variant="ghost">Remove</Button>,
                  ],
                ]}
              />
              <LimitMeter used={3} max={3} label="Must-visits" />
              <Field label="Avoid (Plus)">
                <Row gap={8} align="center">
                  <TextInput placeholder="Places you've already seen…" disabled />
                  <Pill size="sm">Plus</Pill>
                </Row>
              </Field>
            </Stack>
          )}
          {step === 5 && (
            <Stack gap={14}>
              <H3>Review your brief</H3>
              <Text size="small" tone="secondary">
                Everything the planner will know about your trip. Anything missing here, it won't know.
              </Text>
              <Table
                headers={["", "", ""]}
                rows={[
                  ["Destination & dates", "Tuscany · 6 nights · Tue 12 – Mon 18 May 2027", <Button variant="ghost" onClick={() => setStep(0)}>Edit</Button>],
                  ["Flights", "Arrive FLR 11:40 day 1 · Depart PSA 18:30 last day", <Button variant="ghost" onClick={() => setStep(0)}>Edit</Button>],
                  ["Who", "Couple · no kids · no accessibility needs", <Button variant="ghost" onClick={() => setStep(1)}>Edit</Button>],
                  ["Budget", "€€ · comfortable, not luxury — roughly €150–250 per day for two, excluding your stay", <Button variant="ghost" onClick={() => setStep(1)}>Edit</Button>],
                  ["Getting around", carOk ? "Rental car — OK to rent · pick up FLR day 1, drop PSA last day" : "No car — trains, buses, taxis and walking only", <Button variant="ghost" onClick={() => setStep(1)}>Edit</Button>],
                  ["Diet", "Vegetarian · nut allergy", <Button variant="ghost" onClick={() => setStep(1)}>Edit</Button>],
                  ["Where you sleep", "Agriturismo preferred · happy to move bases", <Button variant="ghost" onClick={() => setStep(1)}>Edit</Button>],
                  ["Pace", `${pace} · rest block on · ${trustHours ? "hours set by the planner" : "hours set by you (below)"}`, <Button variant="ghost" onClick={() => setStep(2)}>Edit</Button>],
                  ["Kind of trip", "Mostly Foodie · also Wine & vineyards", <Button variant="ghost" onClick={() => setStep(3)}>Edit</Button>],
                  ["Interests", [...interests, ...interestsCustom].join(" · "), <Button variant="ghost" onClick={() => setStep(3)}>Edit</Button>],
                  ["In your words", "Must have one great meal a day · avoid long museum days · slow morning, a hill town, a tasting with a view", <Button variant="ghost" onClick={() => setStep(3)}>Edit</Button>],
                  ["Must-visits", "Uffizi · Antinori nel Chianti Classico · La Vecchia Latteria", <Button variant="ghost" onClick={() => setStep(4)}>Edit</Button>],
                  ["Output language", "English", <Button variant="ghost" onClick={() => setStep(0)}>Edit</Button>],
                ]}
                framed
              />

              <Divider />

              <Row gap={10} align="center">
                <Stack gap={2}>
                  <Text weight="semibold">Your days</Text>
                  <Text size="small" tone="tertiary">
                    {trustHours
                      ? "The planner will choose each day's start and end from your pace, sunrise/sunset, opening hours and flights. You'll see them in the plan and can still adjust afterwards."
                      : "Adjust any day's start or end. Day 1 and the last day are anchored to your flights."}
                  </Text>
                </Stack>
                <Spacer />
                <Text size="small" tone="secondary">Let the planner set my hours</Text>
                <Toggle checked={trustHours} onChange={setTrustHours} />
              </Row>
              <Table
                headers={["Day", "Start", "End", "Note"]}
                rows={days.map((d, i) => [
                  d.date,
                  trustHours ? <Text size="small" tone="quaternary">planner</Text> : <TextInput value={d.start} onChange={(v) => setDay(i, "start", v)} style={{ width: 72 }} />,
                  trustHours ? <Text size="small" tone="quaternary">planner</Text> : <TextInput value={d.end} onChange={(v) => setDay(i, "end", v)} style={{ width: 72 }} />,
                  <Text size="small" tone="tertiary">{d.note}</Text>,
                ])}
                rowTone={[undefined, undefined, trustHours ? undefined : "info", undefined, undefined, trustHours ? undefined : "info", undefined]}
              />
              {!trustHours && (
                <Text size="small" tone="quaternary">
                  Highlighted days differ from your default (10:00–21:00). Editing individual days on Free is allowed; saving them as reusable presets is Plus.
                </Text>
              )}

              <Divider />

              <Row gap={10} align="center">
                <Stack gap={2}>
                  <Text weight="semibold">Notes for the planner</Text>
                  <Text size="small" tone="tertiary">
                    Anything the form couldn't ask. Each note is classified (rule / preference / optimisation / info) and the plan reports whether it was honoured.
                  </Text>
                </Stack>
                <Spacer />
                <Text size="small" tone="tertiary">{notes.length} / 2 on Free</Text>
              </Row>
              <Stack gap={6}>
                {notes.map((n, i) => (
                  <Row key={i} gap={8} align="start" style={{ padding: "8px 10px", border: `1px solid ${t.stroke.secondary}`, borderRadius: 6 }}>
                    <Pill size="sm">{n.kind}</Pill>
                    <Text size="small" style={{ flex: 1 }}>{n.text}</Text>
                    <Button variant="ghost" onClick={() => setNotes(notes.filter((_, j) => j !== i))}>Remove</Button>
                  </Row>
                ))}
                {notes.length < 2 && (
                  <Row gap={8} align="center">
                    <TextInput
                      value={noteDraft}
                      onChange={setNoteDraft}
                      placeholder="e.g. No driving after dark · We've seen Florence before · Keep Saturday free of long drives"
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="secondary"
                      disabled={!noteDraft.trim()}
                      onClick={() => { setNotes([...notes, { kind: "note", text: noteDraft.trim() }]); setNoteDraft(""); }}
                    >
                      Add note
                    </Button>
                  </Row>
                )}
                <Text size="small" tone="quaternary">{noteDraft.length} / 240 characters per note</Text>
              </Stack>

              <Callout tone="info" title="This is your one free plan">
                You can view and export it forever. Editing it or creating another plan needs Plus.
              </Callout>
              <Text size="small" tone="quaternary">
                Your itinerary is generated by an AI planner from verified place data. Check hours and prices before you go. By continuing you agree to the Terms and Privacy Policy.
              </Text>
              <Row gap={8}>
                <Button variant="primary">Design my trip</Button>
                <Button variant="ghost" onClick={() => setStep(4)}>Back</Button>
              </Row>
            </Stack>
          )}
          {step < 5 && (
            <Row gap={8}>
              <Button variant="primary" onClick={() => setStep(Math.min(5, step + 1))}>
                Continue
              </Button>
              <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))}>
                Back
              </Button>
            </Row>
          )}
        </Stack>
        <Stack gap={10}>
          <Card>
            <CardHeader>Your brief so far</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">Tuscany · 6 nights</Text>
                <Text size="small" tone="secondary">
                  Couple · rental car · €€
                </Text>
                <Text size="small" tone="secondary">
                  {pace} pace
                </Text>
                <Text size="small" tone="secondary">
                  Foodie · Wine
                </Text>
              </Stack>
            </CardBody>
          </Card>
          <Callout tone="neutral" title="Free plan limits">
            2 vacation types · 3 interests · 3 must-visits · 300-char brief · up to 7 nights.
            <div style={{ marginTop: 6 }}>
              <Button variant="secondary">See Plus</Button>
            </div>
          </Callout>
        </Stack>
      </Grid>
      )}
    </Frame>
  );
}

function Field({ label, children }: { label: string; children: Node }) {
  return (
    <Stack gap={4}>
      <Text size="small" tone="secondary" weight="medium">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Generating
// ---------------------------------------------------------------------------

const GEN_STEPS: { label: string; state: "done" | "active" | "todo"; meta?: string }[] = [
  { label: "Reading your brief", state: "done", meta: "Gemini 3.8 Flash" },
  { label: "Loading the Tuscany menu", state: "done", meta: "1,340 verified places" },
  { label: "Finding places for 'cooking class' and 'pistachio gelato Siena'", state: "done", meta: "2 web-verified" },
  { label: "Choosing where you sleep and the shape of the week", state: "done", meta: "Gemini 3.8 Flash" },
  { label: "Laying out each day with drive times and opening hours", state: "done", meta: "OpenRouteService" },
  { label: "Expert review — round 1", state: "done", meta: "3 changes" },
  { label: "Expert review — round 2", state: "active", meta: "checking 1 remaining issue" },
  { label: "Final check against your brief", state: "todo" },
  { label: "Writing your itinerary", state: "todo" },
];

function GeneratingScreen() {
  const t = useHostTheme();
  return (
    <Frame url="wayfare.app/plan/8f3a… · generating">
      <TopNav signedIn tier="Free" lang="en" onLang={() => undefined} />
      <Grid columns="1fr 1fr" gap={20} align="start">
        <Stack gap={10}>
          <H3>Designing your Tuscany week</H3>
          <Text size="small" tone="secondary">
            Usually 1–2 minutes. You can close this tab — we'll pick up where we left off.
          </Text>
          <Stack gap={0}>
            {GEN_STEPS.map((s, i) => (
              <Row key={s.label} gap={10} align="center" style={{ padding: "6px 0" }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    flexShrink: 0,
                    background:
                      s.state === "done"
                        ? t.accent.primary
                        : s.state === "active"
                          ? t.category.orange
                          : t.fill.primary,
                  }}
                />
                <Text size="small" tone={s.state === "todo" ? "tertiary" : "primary"}>
                  {s.label}
                </Text>
                <Spacer />
                {s.meta && (
                  <Text size="small" tone="quaternary">
                    {s.meta}
                  </Text>
                )}
                {i === 6 && <Pill size="sm">now</Pill>}
              </Row>
            ))}
          </Stack>
        </Stack>
        <Stack gap={10}>
          <H3>What the reviewer changed</H3>
          <Table
            headers={["Round", "Change", "Why"]}
            rows={[
              ["1", "Swapped Castello di Ama → Antinori nel Chianti Classico", "Your must-visit; 2 h less driving"],
              ["1", "Added dinner on day 4 · Osteria Le Logge, Siena", "No dinner was planned"],
              ["1", "Moved Uffizi to Wednesday 09:00", "Closed Monday; queues shortest at opening"],
              ["2", "Checking: day 3 walking 9.4 km vs your 8 km cap", "In progress"],
            ]}
            rowTone={["success", "success", "success", "warning"]}
          />
          <Note>Every change is kept on the finished plan under "How this plan was refined".</Note>
        </Stack>
      </Grid>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — Plan view
// ---------------------------------------------------------------------------

type Stop = {
  n: number;
  time: string;
  name: string;
  area: string;
  total: string;
  cat: string;
  badge?: string;
  link?: boolean;
  travel?: string;
  x: number;
  y: number;
};

const DAY_COLORS: Color[] = ["blue", "green", "orange", "purple", "pink", "cyan"];

const DAYS: { label: string; base: string; stops: Stop[] }[] = [
  {
    label: "Day 1 · Tue 12 May",
    base: "Florence · Oltrarno",
    stops: [
      { n: 1, time: "13:00", name: "Check-in · Palazzo Guadagni", area: "Oltrarno", total: "≈ 30 min", cat: "stay", x: 120, y: 90 },
      { n: 2, time: "13:45", name: "Trattoria Sostanza", area: "Santa Maria Novella", total: "≈ 1.5 h", cat: "food.restaurant", badge: "Classic must-see", travel: "12 min walk", link: true, x: 150, y: 70 },
      { n: 3, time: "15:45", name: "Piazzale Michelangelo at golden hour", area: "Oltrarno", total: "≈ 45 min", cat: "nature.viewpoint", badge: "Trending now · TikTok-mentioned", travel: "20 min walk", x: 175, y: 115 },
      { n: 4, time: "17:00", name: "Rest · back at the hotel", area: "Oltrarno", total: "≈ 1.5 h", cat: "rest", x: 122, y: 92 },
      { n: 5, time: "19:30", name: "Gelateria La Sorbettiera", area: "Oltrarno", total: "≈ 20 min", cat: "food.dessert", badge: "Trending now · Reddit", travel: "8 min walk", link: true, x: 105, y: 110 },
      { n: 6, time: "20:15", name: "Dinner · Il Santo Bevitore", area: "Oltrarno", total: "≈ 2 h", cat: "food.restaurant", travel: "5 min walk", link: true, x: 98, y: 98 },
    ],
  },
  {
    label: "Day 4 · Fri 15 May",
    base: "Siena · Centro",
    stops: [
      { n: 1, time: "10:00", name: "Antinori nel Chianti Classico · tour & tasting", area: "Chianti", total: "≈ 2.5 h", cat: "food.wine", badge: "Must-visit", travel: "45 min drive", link: true, x: 210, y: 170 },
      { n: 2, time: "13:15", name: "Lunch · Rinuccio 1180 (on site)", area: "Chianti", total: "≈ 1.5 h", cat: "food.restaurant", link: true, x: 212, y: 172 },
      { n: 3, time: "16:00", name: "Check-in · Siena base", area: "Siena", total: "≈ 30 min", cat: "stay", travel: "50 min drive", x: 260, y: 250 },
      { n: 4, time: "17:00", name: "La Vecchia Latteria · pistachio gelato", area: "Siena", total: "≈ 20 min", cat: "food.dessert", badge: "Must-visit · web-verified", travel: "6 min walk", link: true, x: 270, y: 262 },
      { n: 5, time: "17:30", name: "Piazza del Campo · slow wander", area: "Siena", total: "≈ 1 h", cat: "history.landmark", x: 278, y: 256 },
      { n: 6, time: "20:00", name: "Dinner · Osteria Le Logge", area: "Siena", total: "≈ 2 h", cat: "food.restaurant", badge: "Added by reviewer", travel: "4 min walk", link: true, x: 284, y: 266 },
    ],
  },
];

function PlanMap({ day }: { day: number }) {
  const t = useHostTheme();
  const d = DAYS[day];
  const color = t.category[DAY_COLORS[day]];
  const pts = d.stops.map((s) => `${s.x},${s.y}`).join(" ");
  return (
    <svg width="100%" viewBox="0 0 400 320" style={{ border: `1px solid ${t.stroke.secondary}`, borderRadius: 6, background: t.fill.quaternary }} role="img" aria-label="Itinerary map">
      {/* faint region shapes */}
      <path d="M40 60 q80 -40 160 -10 q120 10 150 90 q10 90 -60 140 q-120 30 -200 -20 q-70 -80 -50 -200z" fill={t.fill.tertiary} />
      <path d="M60 130 q40 -30 90 -10 q30 60 -10 110 q-60 20 -80 -40z" fill="none" stroke={t.stroke.secondary} strokeDasharray="3 3" />
      {/* area labels */}
      <text x={92} y={52} fontSize={10} fill={t.text.tertiary}>Florence</text>
      <text x={196} y={150} fontSize={10} fill={t.text.tertiary}>Chianti</text>
      <text x={250} y={290} fontSize={10} fill={t.text.tertiary}>Siena</text>
      <text x={300} y={200} fontSize={10} fill={t.text.tertiary}>Val d'Orcia</text>
      <text x={40} y={230} fontSize={10} fill={t.text.tertiary}>Pisa</text>
      {/* other days, muted */}
      <polyline points="120,90 300,190 320,210" fill="none" stroke={t.stroke.primary} strokeWidth={1.5} strokeDasharray="4 4" />
      {/* route */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} />
      {d.stops.map((s) => (
        <g key={s.n}>
          <circle cx={s.x} cy={s.y} r={s.cat === "stay" ? 9 : 8} fill={s.cat === "stay" ? t.bg.elevated : color} stroke={s.cat === "stay" ? color : t.bg.editor} strokeWidth={2} />
          <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={s.cat === "stay" ? color : t.text.onAccent}>
            {s.n}
          </text>
        </g>
      ))}
      {/* attribution (ODbL requirement) */}
      <rect x={236} y={304} width={160} height={14} fill={t.bg.elevated} opacity={0.9} />
      <text x={392} y={314} textAnchor="end" fontSize={8} fill={t.text.tertiary}>
        © OpenStreetMap contributors · OpenFreeMap
      </text>
      {/* legend */}
      <rect x={8} y={276} width={150} height={36} rx={4} fill={t.bg.elevated} stroke={t.stroke.tertiary} />
      <circle cx={20} cy={288} r={4} fill={color} />
      <text x={30} y={291} fontSize={9} fill={t.text.secondary}>{d.label}</text>
      <line x1={14} y1={302} x2={26} y2={302} stroke={t.stroke.primary} strokeDasharray="3 3" />
      <text x={30} y={305} fontSize={9} fill={t.text.secondary}>Other days</text>
    </svg>
  );
}

function PlanScreen() {
  const t = useHostTheme();
  const [day, setDay] = useCanvasState<number>("planDay", 0);
  const d = DAYS[day];
  return (
    <Frame url="wayfare.app/plan/8f3a… · Tuscany, 6 nights">
      <TopNav signedIn tier="Free" lang="en" onLang={() => undefined} />
      <Row gap={10} align="center" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 590, color: t.text.primary }}>A slow, delicious week in Tuscany</div>
        <Select
          value="v3"
          options={[
            { value: "v3", label: "v3 · current · Regenerate" },
            { value: "v2", label: "v2 · Edit" },
            { value: "v1", label: "v1 · Original" },
          ]}
          style={{ width: 200 }}
        />
        <Spacer />
        <Button variant="secondary">Export PDF</Button>
        <Button variant="secondary">Google Docs</Button>
        <Button variant="secondary">Share link</Button>
        <Button variant="ghost" disabled>
          Edit · Plus
        </Button>
      </Row>
      <Row gap={6} wrap style={{ marginBottom: 12 }}>
        {["Tue 12", "Wed 13", "Thu 14", "Fri 15", "Sat 16", "Sun 17", "Mon 18"].map((l, i) => {
          const idx = i === 0 ? 0 : i === 3 ? 1 : -1;
          return (
            <Pill key={l} size="sm" active={idx === day} disabled={idx < 0} onClick={() => idx >= 0 && setDay(idx)}>
              {l}
            </Pill>
          );
        })}
        <Spacer />
        <Text size="small" tone="tertiary">
          Sleep: Florence ×3 · Siena ×2 · Val d'Orcia ×1
        </Text>
      </Row>
      <Grid columns="1fr 1fr" gap={16} align="start">
        <Stack gap={10}>
          <PlanMap day={day} />
          <Card>
            <CardHeader trailing={<Pill size="sm">{d.base}</Pill>}>Tonight's base</CardHeader>
            <CardBody>
              <Text size="small">
                {day === 0
                  ? "Oltrarno — the artisan side of the river: quieter at night, 10 min walk to the centre, easy parking at Porta Romana. Suggested: Palazzo Guadagni (€€)."
                  : "Siena Centro, inside the walls — you'll walk to dinner and the Campo. Suggested: Hotel Athena (€€, parking on site)."}
              </Text>
              <Row gap={8} style={{ marginTop: 8 }}>
                <Button variant="ghost">Search on Booking</Button>
                <Button variant="ghost">Search on Airbnb</Button>
              </Row>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill size="sm">saves ≈ 3 rental days</Pill>}>Car rental plan</CardHeader>
            <CardBody>
              <Stack gap={8}>
                <Row gap={6} wrap>
                  {["Tue · on foot", "Wed · on foot", "Thu · on foot", "Fri · car", "Sat · car", "Sun · car", "Mon · car → PSA"].map((d, i) => (
                    <Pill key={d} size="sm" active={i >= 3}>
                      {d}
                    </Pill>
                  ))}
                </Row>
                <Text size="small">
                  No car for your three Florence days (historic centre is a ZTL; parking ≈ €30/day). Pick up at Florence
                  Peretola on Friday morning when you leave for Chianti; return at Pisa airport on Monday before your 18:30
                  flight (one-way return usually carries a fee — check when booking).
                </Text>
                <Row gap={8} align="center">
                  <Pill size="sm" active>your note · honoured</Pill>
                  <Text size="small" tone="tertiary">"Optimise the car rental — don't leave it parked a whole day"</Text>
                </Row>
                <Button variant="ghost">Compare rentals FLR → PSA, Fri–Mon</Button>
              </Stack>
            </CardBody>
          </Card>
        </Stack>
        <Stack gap={8}>
          <Row gap={8} align="center">
            <Text weight="semibold">{d.label}</Text>
            <Spacer />
            <Text size="small" tone="tertiary">
              {day === 0 ? "≈ 6.5 active h · 4.1 km walking · 2 areas" : "≈ 7 active h · 3.2 km · 95 min driving"}
            </Text>
          </Row>
          {d.stops.map((s) => (
            <div key={s.n}>
              {s.travel && (
                <Text size="small" tone="quaternary" style={{ margin: "0 0 4px 34px" }}>
                  ↓ {s.travel}
                </Text>
              )}
              <Row gap={10} align="start">
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    flexShrink: 0,
                    background: s.cat === "stay" || s.cat === "rest" ? t.fill.secondary : t.category[DAY_COLORS[day]],
                    color: s.cat === "stay" || s.cat === "rest" ? t.text.secondary : t.text.onAccent,
                    fontSize: 11,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {s.n}
                </span>
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Row gap={8} align="center">
                    <Text size="small" tone="tertiary" style={{ width: 40 }}>
                      {s.time}
                    </Text>
                    <Text weight="medium" truncate>
                      {s.name}
                    </Text>
                    <Spacer />
                    <Text size="small" tone="secondary">
                      {s.total}
                    </Text>
                  </Row>
                  <Row gap={6} wrap style={{ marginLeft: 48 }}>
                    <Text size="small" tone="quaternary">
                      {s.area} · {s.cat}
                    </Text>
                    {s.badge && <Pill size="sm">{s.badge}</Pill>}
                    {s.link && (
                      <Text size="small" style={{ color: t.text.link }}>
                        website
                      </Text>
                    )}
                  </Row>
                </Stack>
              </Row>
            </div>
          ))}
          <Divider />
          <Card collapsible defaultOpen={false}>
            <CardHeader trailing={<Pill size="sm">3 changes</Pill>}>How this plan was refined</CardHeader>
            <CardBody>
              <Stack gap={4}>
                <Text size="small">Swapped Castello di Ama → Antinori (your must-visit, 2 h less driving)</Text>
                <Text size="small">Added dinner on day 4 (none was planned)</Text>
                <Text size="small">Moved Uffizi to Wednesday 09:00 (closed Monday)</Text>
                <Text size="small" tone="tertiary">
                  Reviewed with Gemini 3.8 Flash · passed final check against your brief
                </Text>
              </Stack>
            </CardBody>
          </Card>
          <Card collapsible defaultOpen={false}>
            <CardHeader trailing={<Pill size="sm">Plus</Pill>}>Suggestions you can apply</CardHeader>
            <CardBody>
              <Text size="small">Day 3 walks 9.4 km; swap Boboli Gardens for Bardini Garden to stay under 8 km.</Text>
            </CardBody>
          </Card>
        </Stack>
      </Grid>
      <div style={{ marginTop: 10 }}>
        <Note>
          Click a pin or a stop to open its card: what it is, why it's here, the evidence quote and source for
          "Trending", opening hours, booking note, website. Map: MapLibre + OpenFreeMap tiles; routes from
          OpenRouteService.
        </Note>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 5 — Can't fit (compliance gate failure)
// ---------------------------------------------------------------------------

function BlockedScreen() {
  return (
    <Frame url="wayfare.app/plan/8f3a… · needs a change">
      <TopNav signedIn tier="Free" lang="en" onLang={() => undefined} />
      <Stack gap={12} style={{ maxWidth: 620 }}>
        <H3>We couldn't fit everything you asked for</H3>
        <Text tone="secondary">
          We don't show plans that break your brief. Your free plan has <Text weight="semibold">not</Text> been used.
        </Text>
        <Callout tone="danger" title="Must-visit can't fit: Uffizi Gallery">
          Your only Florence day is Monday 12 May and the Uffizi is closed on Mondays. Options: add a Florence
          night, move the trip by a day, or drop it from must-visits.
        </Callout>
        <Callout tone="warning" title="Day window too short for 'Chill' with 3 must-visits on Thu 14">
          06:00–14:00 leaves ≈ 5 active hours; the three pinned places need ≈ 6.5 h including drives.
        </Callout>
        <Row gap={8}>
          <Button variant="primary">Adjust my brief</Button>
          <Button variant="ghost">Remove Uffizi and retry</Button>
        </Row>
      </Stack>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 6 — Upgrade
// ---------------------------------------------------------------------------

function UpgradeScreen() {
  return (
    <Frame url="wayfare.app/pricing">
      <TopNav signedIn tier="Free" lang="en" onLang={() => undefined} />
      <Stack gap={12}>
        <H3>Edit this plan, or start another</H3>
        <Grid columns={2} gap={16} align="start">
          <Card>
            <CardHeader trailing={<Pill size="sm">current</Pill>}>Free</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text weight="semibold">One plan, forever yours</Text>
                <Text size="small" tone="secondary">1 generation · up to 7 nights · 2 vacation types · 3 interests · 3 must-visits</Text>
                <Text size="small" tone="secondary">PDF export · share link</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill size="sm">monthly</Pill>}>Plus</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text weight="semibold">3 new plans a month + edit anything</Text>
                <Text size="small" tone="secondary">
                  10 regenerations · unlimited surgical edits · up to 21 nights · any mix · unlimited must-visits ·
                  avoid list · per-date day windows · custom events
                </Text>
                <Text size="small" tone="secondary">+ Google Docs export · version history · 3 review rounds</Text>
                <Row gap={8} style={{ marginTop: 6 }}>
                  <Button variant="primary">Continue to checkout</Button>
                  <Text size="small" tone="tertiary">price placeholder · Stripe test mode</Text>
                </Row>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
        <Note>Shown when a free user clicks Edit, Regenerate, or "New plan". Tier is enforced server-side.</Note>
      </Stack>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 7 — My plans
// ---------------------------------------------------------------------------

const TUSCANY_VERSIONS: { v: string; when: string; origin: string; summary: string; current?: boolean }[] = [
  { v: "v3", when: "Today 14:02", origin: "Regenerate", summary: "Pace changed to Chill; day 3 rebuilt, Pisa dropped", current: true },
  { v: "v2", when: "Yesterday", origin: "Edit", summary: "Swapped Castello di Ama → Antinori; moved Uffizi to Wed" },
  { v: "v1", when: "3 days ago", origin: "Original", summary: "First generation from your brief" },
];

function VersionHistory({ onClose }: { onClose: () => void }) {
  return (
    <Card>
      <CardHeader trailing={<Pill size="sm">Tuscany · 6 nights</Pill>}>Version history</CardHeader>
      <CardBody>
        <Stack gap={10}>
          <Text size="small" tone="secondary">
            Every generation and edit is kept. Restoring never deletes anything — it copies the chosen version to a
            new one, so you can always come back.
          </Text>
          <Table
            headers={["Version", "When", "Origin", "What changed", ""]}
            rows={TUSCANY_VERSIONS.map((r) => [
              <Row gap={6} align="center">
                <Text size="small" weight="medium">{r.v}</Text>
                {r.current && <Pill size="sm" active>current</Pill>}
              </Row>,
              r.when,
              r.origin,
              r.summary,
              <Row gap={6}>
                <Button variant="ghost">View</Button>
                <Button variant="ghost" disabled={r.current}>
                  Compare
                </Button>
                <Button variant={r.current ? "ghost" : "secondary"} disabled={r.current}>
                  Restore as v4
                </Button>
              </Row>,
            ])}
            rowTone={["success", undefined, undefined]}
          />
          <Row gap={8}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Spacer />
            <Text size="small" tone="quaternary">Restore is a surgical edit — no AI call, instant, doesn't count against your quota</Text>
          </Row>
        </Stack>
      </CardBody>
    </Card>
  );
}

function MyPlansScreen() {
  const [showHistory, setShowHistory] = useState(true);
  return (
    <Frame url="wayfare.app/trips">
      <TopNav signedIn tier="Plus" lang="en" onLang={() => undefined} />
      <Row gap={10} align="center" style={{ marginBottom: 12 }}>
        <H3>Your trips</H3>
        <Spacer />
        <Text size="small" tone="tertiary">
          This month: 1 / 3 new plans · 2 / 10 regenerations
        </Text>
        <Button variant="primary">New trip</Button>
      </Row>
      <Stack gap={12}>
        <Table
          headers={["Trip", "Dates", "Status", "Versions", "Shared", ""]}
          rows={[
            [
              "Tuscany · 6 nights",
              "12–18 May 2027",
              "Ready",
              <Pill size="sm" active={showHistory} onClick={() => setShowHistory(!showHistory)} title="Open version history">
                v3 · 3 versions
              </Pill>,
              "yes",
              <Button variant="ghost">Open</Button>,
            ],
            ["Kyoto & Osaka · 9 nights", "3–12 Nov 2027", "Ready", <Pill size="sm">v1</Pill>, "no", <Button variant="ghost">Open</Button>],
            ["Lisbon weekend", "—", "Queued · resumes 10:00", "—", "no", <Button variant="ghost">Open</Button>],
          ]}
          rowTone={["success", "success", "warning"]}
        />
        {showHistory && <VersionHistory onClose={() => setShowHistory(false)} />}
      </Stack>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Screen 8 — Admin
// ---------------------------------------------------------------------------

const ADMIN_TABS = ["Magic numbers", "Model registry", "Users", "Scouting", "Quota & health"];

function AdminScreen() {
  const t = useHostTheme();
  const [tab, setTab] = useCanvasState<number>("adminTab", 1);
  return (
    <Frame url="wayfare.app/admin · re-authenticated 4 min ago">
      <TopNav signedIn tier="Plus" lang="en" onLang={() => undefined} />
      <Row gap={6} wrap style={{ marginBottom: 12 }}>
        {ADMIN_TABS.map((s, i) => (
          <Pill key={s} size="sm" active={i === tab} onClick={() => setTab(i)}>
            {s}
          </Pill>
        ))}
        <Spacer />
        <Pill size="sm">owner · uid ····9f21</Pill>
      </Row>
      {tab === 0 && (
        <Stack gap={10}>
          <Table
            headers={["Setting", "Chill", "Balanced", "Packed", "Default", "Last change"]}
            rows={[
              ["Active hours / day", <TextInput value="5" />, <TextInput value="7" />, <TextInput value="9.5" />, "5 / 7 / 9.5", "—"],
              ["Areas / day", <TextInput value="2" />, <TextInput value="4" />, <TextInput value="6" />, "2 / 4 / 6", "—"],
              ["Walking km / day", <TextInput value="5" />, <TextInput value="8" />, <TextInput value="12" />, "5 / 8 / 12", "—"],
              ["Rest block (min)", <TextInput value="90" />, <TextInput value="60" />, <TextInput value="0" />, "90 / 60 / 0", "—"],
            ]}
          />
          <Table
            headers={["Setting", "Free", "Plus", "Note"]}
            rows={[
              ["Refinement iterations", <TextInput value="2" />, <TextInput value="3" />, "critic → refine rounds"],
              ["Must-visits cap", <TextInput value="3" />, <TextInput value="∞" />, ""],
              ["Shortlist size", <TextInput value="180" />, <TextInput value="220" />, "places offered to the model"],
              ["Fast Pack target places", <TextInput value="250" />, <TextInput value="250" />, "unscouted destinations"],
            ]}
          />
          <Row gap={8}>
            <Button variant="primary">Save as config v14</Button>
            <Button variant="ghost">Revert to v13</Button>
            <Spacer />
            <Text size="small" tone="tertiary">Worker & clients reload within 60 s</Text>
          </Row>
        </Stack>
      )}
      {tab === 1 && (
        <Stack gap={12}>
          <Row gap={8} align="center">
            <Text weight="semibold">Best chain · plan-time reasoning</Text>
            <Spacer />
            <Text size="small" tone="tertiary">Scouting uses Best chain</Text>
            <Toggle checked={false} />
          </Row>
          <Stack gap={8}>
            {[
              ["1", "gemini-3.8-flash", "Google", 20, 20, "exhausted · resets 10:00", "orange"],
              ["2", "gemini-3.7-flash", "Google", 20, 20, "exhausted", "orange"],
              ["3", "gemini-3.5-flash", "Google", 14, 20, "serving now", "blue"],
              ["4", "gemini-2.5-pro", "Google", 3, 50, "", "blue"],
              ["5", "gemini-2.5-flash", "Google", 0, 250, "", "blue"],
              ["6", "gemma-4-31b-it", "Google", 0, 1000, "observed limit unknown", "blue"],
              ["7", "nvidia/nemotron-3-ultra-550b:free", "OpenRouter", 0, 50, "shared pool", "blue"],
              ["8", "openrouter/free", "OpenRouter", 0, 50, "shared pool", "blue"],
            ].map(([rank, id, prov, used, max, note, col]) => (
              <Row key={String(id)} gap={10} align="center">
                <Text size="small" tone="tertiary" style={{ width: 14 }}>{String(rank)}</Text>
                <div style={{ width: 300 }}>
                  <Text size="small" truncate>{String(id)}</Text>
                </div>
                <Pill size="sm">{String(prov)}</Pill>
                <div style={{ flex: 1 }}>
                  <UsageBar total={Number(max)} segments={[{ id: "u", value: Number(used), color: col as Color }]} topRightLabel={`${used} / ${max} today`} />
                </div>
                <Text size="small" tone="quaternary" style={{ width: 150 }}>{String(note)}</Text>
                <Toggle checked size="sm" />
              </Row>
            ))}
          </Stack>
          <Row gap={8}>
            <Button variant="secondary">Reorder</Button>
            <Button variant="secondary">Add model</Button>
            <Button variant="ghost">Run eval suite now</Button>
            <Spacer />
            <Text size="small" tone="tertiary">Last eval: 1 Sep · 3.8 Flash 91 · 3.5 Flash 88 · 2.5 Pro 86 · Nemotron Ultra 79</Text>
          </Row>
        </Stack>
      )}
      {tab === 2 && (
        <Stack gap={10}>
          <TextInput placeholder="Search by email or uid…" type="search" />
          <Table
            headers={["User", "Tier", "Source", "Plans", "Free gen used", "Override", ""]}
            rows={[
              ["dana@…", "Plus", "stripe", "4", "yes", <Select value="plus" options={[{ value: "free", label: "Free" }, { value: "plus", label: "Plus" }]} />, <Button variant="ghost">Save</Button>],
              ["omer@…", "Free", "—", "1", "yes", <Select value="free" options={[{ value: "free", label: "Free" }, { value: "plus", label: "Plus" }]} />, <Button variant="ghost">Reset free gen</Button>],
              ["noa@…", "Plus", "admin", "2", "yes", <Select value="plus" options={[{ value: "free", label: "Free" }, { value: "plus", label: "Plus" }]} />, <Button variant="ghost">Save</Button>],
            ]}
          />
          <Note>Overrides require a reason and are written as tierSource=admin so Stripe webhooks don't undo them. Every action lands in the audit log.</Note>
        </Stack>
      )}
      {tab === 3 && (
        <Table
          headers={["Destination", "Status", "Places", "Trending", "Last scout", ""]}
          rows={[
            ["Tuscany", "ready", "1,340", "212", "3 days ago", <Row gap={6}><Button variant="ghost">Refresh trends</Button><Button variant="ghost">Full scout</Button></Row>],
            ["Rome", "ready", "980", "164", "9 days ago", <Row gap={6}><Button variant="ghost">Refresh trends</Button><Button variant="ghost">Full scout</Button></Row>],
            ["Kyoto", "stale", "760", "88", "41 days ago", <Button variant="secondary">Scout now</Button>],
            ["Lisbon", "building", "Fast Pack · 240", "31", "running · 00:48", <Button variant="ghost">View log</Button>],
          ]}
          rowTone={["success", "success", "warning", "info"]}
        />
      )}
      {tab === 4 && (
        <Stack gap={12}>
          <Grid columns={4} gap={12}>
            <Stat value="38" label="Plans today" />
            <Stat value="2" label="Queued for reset" tone="warning" />
            <Stat value="1" label="Gate failures today" tone="danger" />
            <Stat value="1.9 min" label="Median generation" />
          </Grid>
          <Stack gap={8}>
            <UsageBar total={50000} topLeftLabel="Firestore reads (Spark cap 50k/day)" topRightLabel="18.2k / 50k" segments={[{ id: "r", value: 18200, color: "blue" }]} />
            <UsageBar total={20000} topLeftLabel="Firestore writes (20k/day)" topRightLabel="6.4k / 20k" segments={[{ id: "w", value: 6400, color: "blue" }]} />
            <UsageBar total={2000} topLeftLabel="OpenRouteService (2,000/day)" topRightLabel="1,120 / 2,000" segments={[{ id: "o", value: 1120, color: "green" }]} />
            <UsageBar total={500} topLeftLabel="Search grounding · 2.5 Flash-Lite (500/day)" topRightLabel="410 / 500" segments={[{ id: "s", value: 410, color: "orange" }]} />
            <UsageBar total={100000} topLeftLabel="Cloudflare Worker requests (100k/day)" topRightLabel="9.7k / 100k" segments={[{ id: "c", value: 9700, color: "purple" }]} />
          </Stack>
          <div style={{ color: t.text.tertiary, fontSize: 12 }}>All gauges refresh every minute from usageDaily/*.</div>
        </Stack>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function TripPlannerScreens() {
  const [screen, setScreen] = useCanvasState<ScreenId>("screen", "home");
  const [lang, setLang] = useCanvasState<"en" | "he">("lang", "en");
  const [signedIn, setSignedIn] = useCanvasState<boolean>("signedIn", false);
  return (
    <Stack gap={14}>
      <H1>Wayfare — screen mockups</H1>
      <Text tone="secondary">
        Low-fidelity wireframes of the eight core screens. Click a tab to switch; the Home screen has an EN / עב
        toggle to preview RTL. Name "Wayfare" is a placeholder.
      </Text>
      <Row gap={6} wrap align="center">
        {SCREENS.map((s) => (
          <Pill key={s.id} active={s.id === screen} onClick={() => setScreen(s.id)}>
            {s.label}
          </Pill>
        ))}
        <Spacer />
        <Text size="small" tone="tertiary">
          Mock auth: {signedIn ? "signed in" : "signed out"}
        </Text>
        <Toggle size="sm" checked={signedIn} onChange={setSignedIn} />
      </Row>
      {screen === "home" && (
        <HomeScreen
          lang={lang}
          onLang={setLang}
          signedIn={signedIn}
          onSignIn={() => setSignedIn(true)}
          onStartPlan={() => setScreen("brief")}
        />
      )}
      {screen === "brief" && <BriefScreen />}
      {screen === "generating" && <GeneratingScreen />}
      {screen === "plan" && <PlanScreen />}
      {screen === "blocked" && <BlockedScreen />}
      {screen === "upgrade" && <UpgradeScreen />}
      {screen === "myplans" && <MyPlansScreen />}
      {screen === "admin" && <AdminScreen />}
      <Divider />
      <H2>Flow</H2>
      <Table
        headers={["From", "Action", "To"]}
        rows={[
          ["Home", "Click country / pick region → Sign in with Google", "Trip Brief"],
          ["Trip Brief", "Design my trip (quota checked server-side)", "Generating"],
          ["Generating", "Final check passes", "Plan view"],
          ["Generating", "Final check fails (must-visit can't fit)", "Can't fit → back to Brief, free plan not consumed"],
          ["Plan view", "Edit / Regenerate / New plan on Free", "Upgrade"],
          ["Plan view", "Share link", "Public read-only /p/{id} (same map, no personal data)"],
          ["Any", "Owner UID only, fresh re-auth", "Admin"],
        ]}
      />
    </Stack>
  );
}
