# Projektdokumentation L.U.N.A.

**L.U.N.A. — Lunar Understanding, Navigation & Analysis** · Team TerraBits · NASA Space Apps 2026 Berlin · Challenge „Lunar Landing Site Navigator“

Stand: 15.11.2026, 18:15 Uhr (MEZ) · beschriebener Code: Repo `TerrabitsHackathon`, Branch `integration`, Commit `4fe00c9`, Arbeitsordner ohne offene Änderungen

Dieses Dokument ist die Gesamtdokumentation des fertigen Produkts. Es fasst die 19 Arbeitsdokumente des Projekts zusammen und ersetzt sie als Einstieg (Abschnitt 16 sagt, welche davon noch gelten). Grundlage sind der Quelltext im genannten Commit, das README des Repos, die Arbeitsdokumente und eine Nachrechnung der Kernzahlen am 15.11. (Abschnitt 8.2). Wo eine Zahl nicht nachgerechnet, sondern aus einem Arbeitsdokument übernommen ist, steht das dabei.

| Wer liest | Abschnitte |
| --- | --- |
| Leitung, Abgabe | 1, 2, 12, 13 |
| Wissenschaft, Validierung | 5, 6, 8, 9 |
| Lehre, Einstieg ohne Vorwissen | 3, 4, 10, 15 |
| Entwicklung | 7, 11 |

## 1. Kurzfassung

**Was es ist.** L.U.N.A. ist eine Webseite, die für jeden Punkt des Mondes und jedes Datum von 2027 bis 2066 zeigt, ob dort die Sonne (Strom) und die Erde (direkter Funk) über dem echten Geländehorizont stehen, wie lange am Stück nicht, und wie sich das ändert, wenn sich der Landetermin verschiebt. Sie läuft im Browser; lokal braucht sie nur einen kleinen Python-Server (Abschnitt 7.3).

**Für wen.** Missionsplanung, Lehrende und interessierte Öffentlichkeit, wie in der Challenge verlangt.

**Worauf es beruht.** Positionen von Sonne und Erde aus NASA JPL Horizons, Gelände aus den LOLA-Höhenmodellen der NASA. Beides wird vorab in Dateien gepackt; gerechnet wird im Browser.

**Was es von den gelesenen Projekten anderer Teams unterscheidet** (laut deren README, nicht nachgeprüft): Gelände in 474-m-Auflösung für jeden Punkt des Mondes statt nur am Südpol, eine Systemansicht mit wahrer Geometrie von Sonne, Erde und Mond, 40 Jahre Horizons-Daten.

**Stand in einem Satz.** Das Produkt ist gebaut, alle 37 automatischen Prüfungen bestehen; die Bestandteile der Abgabe außerhalb des Codes (öffentlicher Link auf dem fertigen Stand, Video, Projektseite) sind nicht belegt.

**Team** (Rollen wie auf der Seite angegeben): Roman Belomutskiy (Concept & Presentation), Nakulan Sundarraju (3D Modeling & Data Engineering), Lenni Kolhoff (Product Vision & UX/UI), Timur Belomutskiy (Product Delivery & Operations). Rückmeldungen von Johannes Hille und Edgar Bunte.

**Die fünf wichtigsten Vorbehalte**

1. **Die fertige Version liegt auf `integration`, nicht auf `main`.** Der öffentliche Stand auf GitHub (`main`) ist ein älterer Frontend-Stand mit dem README des Planungsboards (Abschnitt 12).
2. **Alle Ergebnisse sind Punktwerte.** An Polgraten ändern wenige hundert Meter das Ergebnis. Beispiel Connecting ridge, 2027: längste Dunkelphase 246 h mit dem feinen 5-m-Gelände, 99 h mit dem 474-m-Raster, das für freie Punkte gilt.
3. **Kein Abgleich mit Bildern oder veröffentlichten Beleuchtungskarten.** Geprüft ist der Himmel gegen Horizons und die Rechnung gegen sich selbst, nicht das Ergebnis gegen LROC-Aufnahmen, QuickMap oder Literatur.
4. **Die Grenzen 6 h und 12 h sind Annahmen des Teams,** keine Daten eines Landers. Die Seite kennzeichnet sie so.
5. **Ein Satz der Demo ist zu stark** („The cause is terrain, not season“, Abschnitt 10.3).

## 2. Aufgabe und Abdeckung

Die Challenge verlangt ein intuitives Werkzeug, mit dem sich Landeplätze und Termine schnell vergleichen lassen: Sonne und Erde relativ zum Horizont, für Stromerzeugung und direkte Funkfenster. Hintergrund: QuickMap, Moon Trek und Horizons sind für den schnellen Szenarienvergleich zu aufwendig; Missionen rutschen, dann müssen andere Plätze oder Termine schnell bewertet werden, besonders am Südpol.

| Ziel der Challenge | Im Produkt | Einschränkung |
| --- | --- | --- |
| 1. Kuratierte Liste, eigene Koordinaten, Vergleich nebeneinander | 9 gelistete Plätze; eigener Punkt per Klick, Suche oder Koordinatenfeld; mehrere Infokarten zugleich; „Compare as table“ mit Urteilssatz | 9 Plätze sind wenig (andere Teams nennen 16 bis 41) |
| 2. Termine und Uhrzeiten, Mondtage, Jahreszeiten | Eine Uhr für alles, 2027 bis 2066 aus Horizons; Start und Stop; Tempo bis ein Jahr in 25 s; Verzugszeile je Karte | Außerhalb 2027 bis 2066 ein gröberes Rechenmodell, als solches angezeigt |
| 3. Sonne und Erde relativ zum Horizont, Zeit bis Untergang | Karte: Höhe über dem Geländehorizont, sichtbarer Scheibenanteil, Zeit bis zum nächsten Auf- oder Untergang; „Sky view“ (Horizont über 360°); Geländeansicht | – |
| 4. Kennzahlen | Anteil beleuchteter Stunden, längste Dunkelphase, Anteil mit Erdsicht, längste Funklücke; „Solar elevation“ über die Zeit | Keine Leistungs-, Batterie- oder Funkstreckenrechnung |
| 5. 2D, 3D oder andere Darstellungen | 3D-Systemansicht, 3D-Geländeansicht, farbige Karten auf dem Mond, zwei Diagramme, Tabelle | – |
| 6. Animationen, Zeitleisten | Laufende Uhr mit Zeitraffer, Zeitleiste, geführte Demo | – |
| 7. Fachleute, Lehrende, Öffentlichkeit | Demo in 24 Schritten, Tutorial in 12 Stopps, Blatt „Reference“ | Kein dokumentierter Test mit unbeteiligten Personen |

Hinweise der Challenge: Horizons-Daten vorab laden (umgesetzt), LOLA-Gelände (umgesetzt), keine Atmosphäre (keine Refraktion gerechnet), „kleine Änderungen, große Folgen“ zeigen (Demo; Vergleich Connecting ridge gegen Shackleton rim), Libration (in den Horizons-Daten enthalten).

## 3. Was das Produkt enthält

Die Oberfläche ist englisch. Englische Begriffe in Anführungszeichen sind die Beschriftungen der Seite.

**Titelansicht.** Titel „L.U.N.A.“, links „DEMO.“ und „TUTORIAL.“, rechts ein Absatz zum Zweck. Darunter drei Abschnitte: Nutzen, Mission, Team.

**Systemansicht.** Der Mond als Reliefkörper aus LOLA-Höhen (1.440 × 720 Stützstellen, nicht überhöht), dazu Sonne, Erde, Sternhimmel und die Bahnen von Sonne und Erde. Der Mond steht still, der Himmel dreht sich um ihn. Eine Uhr (UTC) bewegt alles: Normaltempo 1,4 simulierte Stunden pro Sekunde, dazu 2×, 12× (eine Woche in 10 s) und 250× (ein Jahr in 25 s). Die Seite startet auf einem Datum mit Horizons-Daten: heute, falls zwischen 2027 und 2066, sonst kurz nach dem 7. Juli 2028.

**Marker.** Klick auf den Mond, Suche nach einem gelisteten Platz oder Eingabe von Koordinaten in beliebiger Schreibweise. Marker lassen sich umbenennen; benannte Marker bleiben für die Browsersitzung erhalten.

**Infokarte je Marker.**
- Sonne und Erde zur simulierten Zeit: Punkt, über dem der Körper senkrecht steht, Höhe der Scheibenmitte über dem Geländehorizont, sichtbarer Anteil der Scheibe, Zeit bis zum nächsten Auf- oder Untergang (oder „always in view“, „never in view“).
- Für die Zeitspanne (Start bis Stop, sonst die nächsten 24 h): „Illuminated“ und „DTE available“ als Anteil der Stunden, „Longest darkness“ und „Longest DTE outage“ in Stunden, grün oder rot gegen die gesetzten Grenzen.
- Zeile „Terrain data“: worauf der Horizont des Punkts beruht (Abschnitt 5.3).
- Verzugszeile: 30 Quadrate für die Landung mit 0 bis 29 Tagen Verzug und ein Satz wie „holds for 5 days of delay“.
- Knopf „View terrain“.

**Zwei Grenzen und ihre Fläche.** „Max. darkness“ und „Max. DTE outage“ (0 bis 96 h, am Anfang „Off“). Ist eine gesetzt, markiert die Seite auf dem Mond die Fläche, die sie im Zeitfenster einhält; sind beide gesetzt, die Schnittmenge. Darunter steht der Anteil der Mondoberfläche.

**Oberflächen und Ebenen.** „Shaded relief“, „Imagery, LROC WAC“, „Elevation, LOLA“, „Mean illumination, 2027“, „DTE availability, 2027“; zuschaltbar: Bahnen, gelistete Plätze, Gradnetz 30°, Höhenlinien, 200-km-Quadrate. Unter dem Mauszeiger stehen Koordinaten, Höhe und Sonnenhöhe.

**„Solar elevation“.** Sonnenhöhe über dem Geländehorizont über die Zeit, eine Linie je markiertem Punkt, darunter ein Band für die Stunden mit Licht.

**„Sky view“.** Der Horizont eines Punkts über 360° als Silhouette, Sonne und Erde an ihrem Ort, ihr Lauf über die Zeitspanne.

**„Compare as table“.** Die offenen Karten als Tabelle, eine Spalte je Platz, darüber ein Satz als Urteil (Tage Verzug je Platz; Hinweis, wenn die Plätze auf verschiedenem Gelände beruhen).

**Geländeansicht.** 200 × 200 km um den Punkt, maßstäblich, mit Mondkrümmung und Schattenwurf einschließlich des Umlands bis 300 km. Unter dem Mauszeiger: Koordinaten, Höhe, Hangneigung, Sonnenhöhe am Punkt, Einstrahlung auf den Hang. „Mean illumination“ und „DTE availability“ werden hier für das geöffnete Gelände und die eingestellte Zeitspanne neu gerechnet.

**Demo und Tutorial.** Abschnitt 10.

**Nicht im Produkt,** obwohl in früheren Konzepten vorgesehen: Score „Mission Return“ mit Batterie- und Puffermodell, Unsicherheitsspanne auf der Karte, Link zum Teilen, CSV-Export, Platzsuche mit Rangliste, Abgleich mit Literatur.

## 4. Wie es funktioniert, ohne Vorwissen

### 4.1 Die Frage

Ein Lander braucht auf dem Mond zwei Dinge: Sonnenlicht für Strom und freie Sicht zur Erde für Funk ohne Relaissatellit (direct-to-Earth, DTE). Die Seite beantwortet für einen Ort und einen Zeitraum: Wie viel der Zeit ist beides da, und wie lang ist die längste Lücke?

### 4.2 Vier Bausteine

1. **Wo stehen Sonne und Erde?** Das liefert eine Tabelle der NASA (JPL Horizons): für jede Stunde von 2027 bis 2066 der Punkt auf dem Mond, über dem die Sonne senkrecht steht, und der Punkt, über dem die Erde senkrecht steht. Aus diesen zwei Punkten folgt für jeden Ort die Richtung zu Sonne und Erde.
2. **Wie hoch ist der Horizont?** Ein Laser auf der NASA-Sonde LRO (das Instrument LOLA) hat die Höhe der Mondoberfläche vermessen. Die Rechnung „schaut“ vom Ort aus in 360 Richtungen über dieses Gelände und merkt sich je Richtung, wie hoch der höchste Berg oder Kraterrand am Himmel steht. Das Ergebnis ist eine Linie, der Geländehorizont, wie der Rand eines Panoramafotos.
3. **Der Vergleich.** Steht die Scheibe von Sonne oder Erde über dieser Linie? Die Seite rechnet den sichtbaren Anteil der Scheibe aus. Ab der halben Scheibe gilt der Körper als „in view“.
4. **Über die Zeit.** Das wird für jede Stunde wiederholt. Daraus folgen der Anteil der Stunden mit Licht oder Funk und die längste Lücke.

Zwei Wörter, die leicht verwechselt werden: Die **Horizontale** ist die waagerechte Ebene am Standort (Höhenwinkel 0°). Der **Geländehorizont** ist die Linie, die Berge und Kraterränder tatsächlich am Himmel ziehen. Er kann über der Horizontalen liegen (in einer Senke) oder darunter (auf einem Gipfel).

Der Mond hat keine Atmosphäre. Es gibt deshalb keine Dämmerung durch gestreutes Licht. Hell und dunkel wechseln nur in der Zeit, in der die Sonnenscheibe hinter dem Horizont verschwindet oder hervorkommt.

### 4.3 Warum der Südpol heikel ist

- **Die Sonne steht dort immer flach.** Die Drehachse des Mondes ist nur 1,5° geneigt. Genau am Pol kommt die Mitte der Sonne deshalb nie höher als etwa 1,5° über die Horizontale; sie läuft einmal je Mondtag (29,5 Erdtage) am Horizont entlang. Zum Vergleich: 1,5° sind knapp drei Sonnendurchmesser. Abseits des Pols kommt je Grad Abstand ein Grad dazu.
- **Flache Sonne, lange Schatten.** Ein Hügel von 100 m Höhe (etwa 30 Stockwerke) wirft bei 1,5° Sonnenhöhe einen Schatten von fast 4 km.
- **Es gibt Jahreszeiten.** Im Lauf von 347 Tagen pendelt die Sonne am Pol zwischen etwa 1,5° über und 1,5° unter der Horizontalen. Im „Sommer“ schaut sie über die Berge, im „Winter“ bleibt sie dahinter.
- **Die Erde hängt fast fest am Himmel.** Der Mond wendet der Erde immer dieselbe Seite zu. Vom Mond aus steht die Erde deshalb an einer Stelle und pendelt nur bis rund 7° auf und ab. Am Pol liegt diese Stelle am Horizont: Die Erde taucht für etwa zwei Wochen auf und für etwa zwei Wochen ab.
- **Kleine Änderung, große Folge.** Ein paar Wochen später oder ein paar hundert Meter weiter kann derselbe Platz dunkel sein.

### 4.4 Die Geschichte der Demo in einem Absatz

Ein Lander soll am 7. November 2027 auf einer Ebene 32 km vom Südpol landen. An diesem Tag sieht der Platz Sonne und Erde. Der Start verschiebt sich um 90 Tage. Am 5. Februar 2028 liegt derselbe Platz im Schatten der Höhen ringsum, und das Licht kommt erst nach 4.273 Stunden (178 Tagen) zurück. 36 km weiter, am Rand des Kraters Shackleton, scheint am selben Tag die Sonne.

Wer die Geschichte weitererzählt, sollte die Ursache richtig nennen: Es wirken Jahreszeit und Gelände zusammen. Die Demo sagt an einer Stelle „terrain, not season“; das ist zu stark (Abschnitt 10.3).

### 4.5 Häufige Missverständnisse

- **„Die dunkle Seite des Mondes.“** Die Rückseite bekommt so viel Sonne wie die Vorderseite. Was ihr fehlt, ist die Sicht zur Erde. Die Oberfläche „DTE availability“ zeigt genau das.
- **„Ein Tag auf dem Mond ist ein Tag.“** Ein Mondtag dauert 29,5 Erdtage: rund zwei Wochen hell, zwei Wochen dunkel, außer an den Polen.
- **„Am Pol ist es immer hell“ oder „immer dunkel“.** Beides kommt vor, wenige Kilometer nebeneinander: Grate mit fast dauerndem Licht neben Kraterböden, die die Sonne nie sehen.
- **„Die Seite zeigt, wo man landen soll.“** Sie zeigt Licht und Erdsicht. Hangneigung steht nur unter dem Mauszeiger der Geländeansicht; Temperatur, Bodenbeschaffenheit und Treibstoff kommen nicht vor.

### 4.6 Im Unterricht

Drei Aufgaben, die mit der Seite ohne Vorbereitung gehen:

1. Markiere einen Punkt am Äquator und einen am Südpol. Öffne „Solar elevation“. Was unterscheidet die beiden Kurven? Erwartung: Am Äquator steigt die Sonne hoch und geht für zwei Wochen unter; am Pol bleibt die Kurve nahe null.
2. Setze „Max. darkness“ auf 6 h. Welcher Teil des Mondes bleibt grün, und wie wandert er, wenn die Uhr läuft? Erwartung: knapp die Hälfte, die der Sonne zugewandte Seite; sie wandert in 29,5 Tagen einmal um den Mond.
3. Aufgabe am Ende des Tutorials: Finde einen Platz nahe dem Südpol, der über eine Mission von 10 Tagen höchstens 6 h Dunkelheit und 12 h Funklücke hat, auch wenn die Landung zwei Wochen später stattfindet. **Eine geprüfte Lösung liegt nicht vor.** Anhaltspunkt: Connecting ridge hält bei Landung am 07.07.2028 fünf Tage Verzug, Shackleton rim keinen (Abschnitt 8.2).

Was man dabei sagen sollte: Sonne und Erde sind dreifach vergrößert gezeichnet, in der Geländeansicht stehen sie nicht in wahrer Entfernung. Die Grenzen 6 h und 12 h sind gesetzt, um rechnen zu können; sie gehören zu keinem echten Lander. Der Landeplatz der Demo ist gezielt so gesucht, dass der Effekt groß ist.

Praktisch: Die Oberfläche ist englisch (deutsche Entsprechungen in Abschnitt 15). Die Seite braucht einen Rechner mit aktuellem Browser und lädt beim Start rund 50 MB, davon 25 MB für den Film der Sonne; Tablets und Touch-Bedienung sind nicht geprüft. Wie lange Demo und Tutorial dauern, ist nicht gemessen.

## 5. Die Rechnung im Detail

Alle Zahlen der Seite (Karten, Diagramme, Fläche, Verzug, Geländeansicht) kommen aus denselben Funktionen in `core/`. Sie laufen im Browser und in Node.

### 5.1 Bezugssystem

- Alles, was die Seite zeigt, liegt im System **MOON_ME** (Mean Earth/Polar Axis): planetozentrische Breite −90 bis 90°, Länge 0 bis 360° Ost. Das ist das System von Horizons, der polaren LOLA-Produkte und der üblichen Mondkoordinaten.
- Höhen sind Meter über der Bezugskugel mit 1.737,4 km Radius.
- Das globale LOLA-Raster LDEM64 liegt im Hauptachsensystem **MOON_PA**. Jede Abfrage dort geht durch eine feste Drehung aus dem NAIF-Kernel `moon_080317.tf`: v_PA = R₃(67,92″) · R₂(78,56″) · R₁(0,30″) · v_ME. Das sind 0,0288°, am Boden bis rund 875 m. Die Richtung der Drehung ist gemessen, nicht angenommen (Abschnitt 8.1).
- Die LOLA-Produkte beziehen MOON_ME auf die Ephemeride DE421, die Horizons-Tabelle auf DE441. Der Unterschied zwischen beiden Festlegungen ist hier nicht beziffert.

### 5.2 Himmel

- **Quelle:** JPL Horizons API, Ephemeride DE441, abgerufen am 14.11.2026. Abfrage: Beobachtertabelle, Ziel Mond (301), Zentrum Erdmittelpunkt (500@399), Größen 14 (Punkt unter dem Beobachter, also unter der Erde), 15 (Punkt unter der Sonne), 20 (Entfernung), Schritt 1 h, acht Blöcke zu fünf Jahren. 350.641 Zeilen von 01.01.2027 bis 01.01.2067 UTC.
- **Verarbeitung:** unverändert als fünf float32-Reihen gepackt (Rundungsfehler höchstens 0,000015° und 0,016 km). Zwischen den Stunden wird linear interpoliert.
- **Sonne:** Richtung aus dem Punkt unter der Sonne, für den ganzen Mond gleich (Parallaxe 0,0007°).
- **Erde:** Position aus dem Punkt unter der Erde und der Entfernung; die Richtung wird vom Standort aus gebildet. Das erfasst die Parallaxe (bis 0,26°).
- **Außerhalb 2027 bis 2066** rechnet ein analytisches Modell (`lunar-sky.js`: IAU-Rotationsmodell des Mondes, Sonnen- und Mondposition niedriger Genauigkeit). Abweichung gegen Horizons: Sonne bis 0,05°, Erde bis 0,34° laut Dateikommentar; die Nachrechnung am 15.11. ergab an 2.000 Stützstellen bis 0,37°, der Validity-Juror nannte 0,40°. Die Zeitleiste zeigt an, welche Quelle gilt.
- **Nicht modelliert:** Aberration (bis 0,006°), Refraktion (keine Atmosphäre).
- **Was die Prüfung gegen Horizons belegt:** dass unsere Umrechnung von den zwei Punkten auf Azimut und Höhe an einem Standort stimmt, einschließlich Parallaxe und Interpolation. Sie belegt nicht die Ephemeride selbst; beide Seiten des Vergleichs stammen aus Horizons.

### 5.3 Horizont eines Punkts

360 Werte, einer je Grad Azimut (im Uhrzeigersinn von Nord): der Höhenwinkel der Geländelinie, gesehen von 2 m über dem Boden. Der Wert darf negativ sein; von einem Gipfel liegt der Horizont unter der Horizontalen (Connecting ridge: −3,13° bis −0,55°).

Strahlen laufen entlang von Großkreisen. Jeder Geländepunkt im Abstand d gibt mit exakter Kugelgeometrie, also einschließlich der Mondkrümmung:

    tan(el) = ((R + z) · cos θ − r₀) / ((R + z) · sin θ),   θ = d / R,   r₀ = R + z₀ + 2 m

Dabei ist R der Radius der Bezugskugel, z die Höhe des Geländepunkts, z₀ die Höhe des Standorts, d der Abstand entlang der Oberfläche und el der Höhenwinkel gegen die Horizontale des Standorts.

Gerechnet werden 1.440 Strahlen (alle 0,25°); Wert i ist das Maximum über i ± 0,5°. Das Profil liegt damit nie unter der abgetasteten Geländelinie.

Vier Grundlagen, die beste zuerst. Jede Karte nennt die verwendete in der Zeile „Terrain data“.

| Grundlage | Gilt für | Abtastung | Bezeichnung auf der Karte |
| --- | --- | --- | --- |
| 5-m-Profil | Connecting ridge, Shackleton rim | PGDA-5-m-Modell des Platzes, Schritte 5 m bis 5 km, 10 m bis 12 km, 40 m bis 285 km; außerhalb des 5-m-Rasters das 80-m-Polmodell; mit Winkelunsicherheit je Richtung | „5 m site profile“ |
| LDEM64-Block | die 9 gelisteten Plätze und der Demo-Platz überall; jeder andere Punkt mit lokalem Server | Raster 474 m, bilinear in den Block übertragen (alle 391 m über 250 km), Umland in 1 km bis 300 km; Strahl beginnt 0,95 km vom Punkt, Schritt 196 m im Nahraster, 0,5 km im Umland | „LDEM64“ |
| Globusraster | jeder Punkt, sofort | 0,25°-Zellen (7,6 km), Strahl von 15 km bis 300 km | „global grid, 7.6 km (coarse)“ |
| Glatte Kugel | bis das Raster geladen ist | Horizont 0° | „smooth sphere (coarse)“ |

Zwei Punkte dazu:

- **Zielpunkt der zwei 5-m-Plätze** ist der höchste Punkt des 5-m-Rasters (Mittel über 5 × 5 Pixel, mindestens 1 km vom Rand), nicht eine veröffentlichte Landekoordinate.
- **Der Abstand 0,95 km** (zwei Quellpixel) ist eine abgestimmte Annahme. Näheres Gelände kann das Raster nicht unabhängig vom Standort selbst auflösen. Mit kleinerem Abstand zählt die Interpolation unter dem Standort als Hindernis. Die Wahl ist an einem einzigen Ort abgestimmt und beeinflusst das Ergebnis dort stark (Abschnitt 9, Nr. 5).

### 5.4 Sichtbarkeit

Sichtbarer Anteil einer Scheibe mit Radius r, deren Mitte um d über einer geraden Horizontlinie steht:

    f = 0                                          für d ≤ −r
    f = ½ + ( d·√(r² − d²) / r² + asin(d / r) ) / π   für −r < d < r
    f = 1                                          für d ≥ r

- Horizonthöhe: der Wert des Profils im Azimut der Scheibenmitte, zwischen zwei Graden linear interpoliert.
- Sonnenradius 0,2666°. Erdradius aus der Entfernung, rund 0,95°.
- **„In view“ ab f = 50 %.** Das ist gleichbedeutend damit, dass die Scheibenmitte über der Horizontlinie steht.
- Empfänger 2 m über Grund.

### 5.5 Kennzahlen einer Zeitspanne

- Stündliche Stichproben von Start bis Stop. Ohne gesetzte Spanne gilt für Karten und Fläche „Next 24 h“ ab der simulierten Zeit, für die Diagramme zwei Mondtage.
- Der Moment, in dem eine Scheibe 50 % kreuzt, wird zwischen zwei Stichproben linear interpoliert.
- „Illuminated“ und „DTE available“: Anteil der Stunden in Sicht. „Longest darkness“ und „Longest DTE outage“: längste zusammenhängende Zeit unter 50 %.
- Läuft eine Lücke in den Anfang oder das Ende der Spanne, zählt sie nur bis dorthin und trägt „≥“.
- Bei Spannen über 9.000 Stunden (375 Tage) wird der Schritt vergrößert. Die Karte sagt das nicht.
- Nächster Auf- oder Untergang: stündlich für 60 Tage, dann alle 6 h bis 19 Jahre, auf die Minute eingegrenzt.

### 5.6 Verzug

Eine Mission landet zur Zeit L und dauert M. Um k Tage verschoben (k = 0 bis 29) deckt sie das Fenster [L + k Tage, L + k Tage + M]. Ein Tag ist „machbar“, wenn in diesem Fenster die längste Dunkelphase und die längste Funklücke die gesetzten Grenzen einhalten. Eine Grenze auf „Off“ zählt nicht; stehen beide auf „Off“, gibt es kein Urteil.

- L und M: Start und Stop der Zeitleiste. Ohne Spanne: Landung zur simulierten Zeit (auf die Stunde), Dauer 10 Tage.
- „holds for N days of delay“: N ist der letzte Tag vor dem ersten, der scheitert. Scheitert schon Tag 0: „not viable on the landing date“. Scheitert keiner: „holds for 29+ days“.
- Auf grobem Gelände (Globusraster, glatte Kugel) sind die Quadrate schraffiert, und statt einer Zahl steht der Hinweis, die Geländeansicht zu öffnen.

### 5.7 Fläche innerhalb der Grenzen

- Raster 0,5° (720 × 360 Zellen). Je Zelle die längste Dunkelphase und die längste Funklücke im Fenster, Definitionen wie in 5.4 und 5.5, Erdrichtung je Zelle.
- Gelände: eine **Skyline-Karte** des ganzen Mondes (`horizon_720x360x24.bin`): Horizont je Zelle in 24 Richtungen, aus dem 7,6-km-Raster, Strahlen von 10 bis 350 km, gespeichert in Stufen von 0,14° zwischen −6° und +30° (Werte außerhalb werden abgeschnitten), zwischen den Richtungen linear interpoliert. Sie zeigt Becken, große Krater und Gebirge, keine kleinen Krater.
- Dauern über 96 h werden als „über 96 h“ geführt. Der Flächenanteil ist nach Zellfläche gewichtet.
- Die Regler wählen nur aus dem fertigen Ergebnis aus und wirken deshalb sofort. Gerechnet wird in bis zu 6 Web-Workern.
- **Fläche und Karte können verschieden urteilen:** Die Fläche nutzt das grobe Gelände, die Karte eines markierten Punkts das beste verfügbare.

### 5.8 Karten in der Geländeansicht

- 129 × 129 Punkte über die 200 km (1,56 km Abstand). Je Punkt ein eigener Horizont in 72 Richtungen durch das Gelände des Blocks, mit eigener Senkrechter (10 km vom Platz ist sie um 0,33° gekippt).
- Je Zeitschritt der sichtbare Scheibenanteil, gemittelt über die Zeitspanne (Start bis Stop, sonst zwei Mondtage). Sonne stündlich bis 30 Tage, darüber höchstens 720 Schritte; Erde höchstens 240.
- Die Farbskala läuft vom kleinsten zum größten Wert dieses Geländes. Farben zweier Plätze sind deshalb nicht vergleichbar; die Legende nennt die Werte.

### 5.9 Globale Karten „Mean illumination, 2027“ und „DTE availability, 2027“

- 0,5°-Zellen, Horizont in 72 Richtungen aus dem 7,6-km-Raster, jede zweite Stunde des Jahres 2027.
- Gezeigt wird der **mittlere sichtbare Scheibenanteil**, nicht der Anteil der Stunden über 50 %. Flächenmittel: Sonne 48,4 %, Erde 48,0 %.
- Kleine dauerhaft beschattete Krater und beleuchtete Ränder sind nicht aufgelöst.

### 5.10 Bild und Zahl

- **Schatten auf dem Mond der Systemansicht** kommen aus derselben Skyline-Karte wie die Fläche: Je Bildpunkt wird die Sonnenhöhe mit dem Horizont verglichen. Das hängt nicht von der Grafikkarte ab.
- **Schatten in der Geländeansicht** rechnet die Grafikkarte aus dem Block in voller Auflösung, einschließlich des nicht gezeichneten Umlands. Unter −4,6° Sonnenhöhe wird das Licht abgeschaltet, weil die Sonne sonst unter dem Rand der Umlanddaten hindurchschiene.
- **Reliefschattierung** dunkelt steile Hänge ab. Sie ist eine Lesehilfe, hängt nur von den Höhen ab und geht in keine Zahl ein.
- **Größen:** Sonne und Erde sind in der Systemansicht dreifach vergrößert, die Erde steht in wahrer Entfernung. In der Geländeansicht stimmen die Richtungen zu Sonne und Erde; ihre Abstände und Größen stimmen dort nicht. Alle Zahlen nutzen die wahren Größen.

### 5.11 Feste Werte

| Größe | Wert | Herkunft |
| --- | --- | --- |
| Mondradius | 1.737,4 km | NASA Fact Sheet; Bezugskugel der LOLA-Höhen |
| Erdradius | 6.371,0 km | NASA Fact Sheet |
| Sonnenradius am Himmel | 0,2666° | 695.700 km in 1 AE |
| Empfängerhöhe | 2 m | Setzung des Teams |
| Schwelle „in view“ | 50 % der Scheibe | Setzung des Teams |
| Stichprobe | 1 h | wie die Horizons-Tabelle |
| Solarkonstante (Anzeige unter dem Mauszeiger) | 1.361 W/m² | Wert für 1 AE |
| Missionsdauer ohne Spanne | 10 Tage | Setzung des Teams |
| Grenzen in der Demo | 6 h Dunkelheit, 12 h Funklücke | Setzung des Teams |

## 6. Woher die Daten kommen

### 6.1 Quellen

| Daten | Quelle | Was wir daraus gemacht haben | Datei |
| --- | --- | --- | --- |
| Sonne und Erde 2027 bis 2066 | NASA JPL Horizons (DE441), abgerufen 14.11.2026 | unverändert gepackt (5.2) | `expiry-date/data/sky_2027_2066.bin` (7,0 MB), `sky_meta.json` |
| Gelände, ganzer Mond | NASA GSFC PGDA, Produkt 95: LOLA MOON_PA, `LDEM64_PA_pixel_202405.tif`, 64 Pixel je Grad, 474 m (715 MB, nicht im Repo) | Globusraster 0,25° in MOON_ME (Flächenmittel aus 16 × 16 Pixeln); Skyline-Karte; Karten 2027; Geländeblöcke | `data/globe/`, `data/exposure/`, `data/terrain/` |
| Gelände, zwei Südpolplätze | PGDA Produkt 78: LOLA-5-m-Modelle Site01 und Site04 mit Unsicherheitskarten; Produkt 90: 80-m-Polmodell `LDEM_80S_80MPP_ADJ` | Horizontprofile, 360 Werte mit Unsicherheit | `expiry-date/data/horizon_site01.json`, `horizon_site04.json` |
| Koordinaten der Plätze | NASA NSSDCA (Apollo-Landeplätze; „Spacecraft on the Moon“); für die zwei Südpolplätze die 5-m-Modelle | Liste mit Quelle je Platz | `expiry-date/data/sites.json` |
| Drehung ME nach PA | NAIF-Kernel `moon_080317.tf` | drei Winkel im Code | `tools/lunar.py` |
| Bild des Mondes | NASA SVS CGI Moon Kit (LROC-WAC-Mosaik) | Textur | `assets/moon-color.jpg` |
| Sonne | NASA/SDO, AIA 304 Å, 10.05.2024; NASA „3D Model of the Sun“ | Film und Modell | `assets/sun-sdo.mp4`, `assets/sun.glb` |
| Sterne | Yale Bright Star Catalogue, 5. Ausgabe, über `github.com/brettonw/YaleBrightStarCatalog` | Liste | `assets/stars-bsc5.json` |
| Erdtextur | **Quelle nicht festgehalten** | Textur | `assets/earth-day.jpg` |

Zitierwunsch der PGDA für die LOLA-Produkte: Barker et al. (2023), Planetary Science Journal 4, 183.

### 6.2 Die neun gelisteten Plätze

| Platz | Breite | Länge Ost | Gelände | Quelle |
| --- | --- | --- | --- | --- |
| Connecting ridge (Site 01) | 89,4390° S | 222,8441° | 5-m-Profil | PGDA Produkt 78 |
| Shackleton rim (Site 04) | 89,7803° S | 203,7857° | 5-m-Profil | PGDA Produkt 78 |
| Apollo 11 | 0,6742° N | 23,4731° | LDEM64 | NSSDCA |
| Apollo 17 | 20,1911° N | 30,7723° | LDEM64 | NSSDCA |
| SLIM | 13,3160° S | 25,2510° | LDEM64 | NSSDCA |
| Blue Ghost 1 | 18,5620° N | 61,8100° | LDEM64 | NSSDCA |
| Chandrayaan-3 | 69,3741° S | 32,3200° | LDEM64 | NSSDCA |
| IM-1 Odysseus | 80,1300° S | 1,4400° | LDEM64 | NSSDCA |
| IM-2 Athena | 84,7906° S | 29,1957° | LDEM64 | NSSDCA |

Dazu kommt der Landeplatz der Demo, ein freier Punkt bei 88,9481° S, 75,048° E (Abschnitt 10.1).

### 6.3 Software und Lizenzen

- **three.js r169** (MIT), lokal in `vendor/`.
- **Schriften** DM Sans, Jost, Inter: werden zur Laufzeit von Google Fonts geladen. Ohne Internet greifen Ersatzschriften.
- **Eigener Code:** MIT-Lizenz, Copyright 2026 TerraBits team (`LICENSE`).
- **Daten und Bilder** behalten die Bedingungen ihrer Quellen.
- Offen: Lizenz des Sternkatalog-Repos nicht geprüft; Quelle der Erdtextur fehlt.

### 6.4 Weg der Daten

    Horizons-Abfrage ──► build_sky.py ──► sky_2027_2066.bin ─────────────────────┐
    5-m-Modelle + 80-m-Polmodell ──► build_horizon.py ──► horizon_site0X.json ───┤
    LDEM64.tif ──► build_globe.py ──► Globusraster ──► build_horizon.mjs ──► Skyline-Karte
                 │                              └──► build_exposure.py ──► Karten 2027 ─┤
                 ├──► build_terrain.py ──► 10 Geländeblöcke ──────────────────────────┤
                 └──► serve.py (/api/terrain) ──► Block für jeden Punkt ───────────────┤
                                                                                      ▼
                                                            core/ (Rechnung) ──► Seite

Die Rohdaten (TIF, 5-m-Modelle, Horizons-Textblöcke) liegen nicht im Repo. Die abgeleiteten Dateien liegen im Repo (rund 24 MB in `data/`, 7 MB Himmel), damit die Seite ohne Python läuft.

### 6.5 Einsatz von KI

Code, Datenskripte und Texte sind mit KI-Unterstützung entstanden (Claude, Anthropic). Jede erzeugte Datendatei trägt einen entsprechenden Vermerk. NASA-Daten wurden neu abgetastet, gemittelt und umgepackt, sonst nicht verändert. Die „Juroren“ und „Reviewer“ in den Arbeitsdokumenten und in Abschnitt 14 sind KI-Rollen, keine Personen.

## 7. Aufbau: Code, Dateien, Start

### 7.1 Ordner

| Pfad | Inhalt |
| --- | --- |
| `index.html`, `tokens.css`, `landing.css` | Seite, Designwerte, Grundgestaltung |
| `landing.js` | Szene, Uhr, Zeitleiste, Sidebar, Oberflächen, Wechsel zwischen System- und Geländeansicht |
| `landing-pins.js`, `landing-search.js` | Marker und Suche |
| `landing-cards.js` | Infokarten mit Kennzahlen, Zeile „Terrain data“, Verzugszeile |
| `landing-compare.js` | Tabelle und Urteilssatz |
| `landing-series.js`, `landing-sky.js` | Diagramme „Solar elevation“ und „Sky view“ |
| `landing-area.js`, `landing-exposure.js` | Steuerung der Flächenrechnung und der Geländekarten (Web-Worker) |
| `landing-demo.js`, `landing-tour.js` | Demo und Tutorial |
| `core/frames.js` | Koordinaten, lokale Achsen, flache Karte eines Platzes, 200-km-Quadrate |
| `core/sky.js` | Horizons-Tabelle lesen, Sonne und Erde zu einer Zeit, Rückfall auf das analytische Modell |
| `core/terrain.js` | Globusraster, Geländeblock, Herkunft der Blöcke (Datei, Server, grob) |
| `core/visibility.js` | Horizont, Scheibenanteil, Reihen, Kennzahlen, nächster Wechsel |
| `core/delay.js` | Verzugstabelle und Urteil |
| `core/area.js`, `core/area-worker.js` | Fläche innerhalb der Grenzen |
| `core/exposure.js`, `core/exposure-worker.js` | Karten in der Geländeansicht |
| `lunar-sky.js` | Analytisches Himmelsmodell; Lage des Mondes zu den Sternen |
| `ui/site-data.js` | Welches Gelände je Marker bekannt ist; lädt besseres nach |
| `view/moon-globe.js`, `view/terrain-view.js`, `view/relief.js`, `view/colors.js` | Mondkörper, Geländeansicht, Reliefschattierung, Farbskalen |
| `tools/` | `serve.py`, `lunar.py`, `build_globe.py`, `build_terrain.py`, `build_exposure.py`, `build_horizon.mjs`, `check_frames.py` |
| `expiry-date/` | Vorläufer-Werkzeug (nicht Teil des Produkts); sein `data/` enthält Himmelstabelle, Platzliste und 5-m-Profile, die die Seite nutzt; seine `tools/` bauen sie |
| `tests/` | Node-Prüfungen |
| `legacy/` | Frühere Seiten, der frühere 3D-Viewer, das Planungsboard. Nicht Teil des Produkts |

Die Seite ist reines JavaScript in ES-Modulen, ohne Build-Schritt und ohne Pakete. Seite, Rechnung, Werkzeuge und Tests umfassen rund 8.700 Zeilen (ohne `expiry-date/` und `legacy/`).

### 7.2 Dateiformate

| Datei | Format |
| --- | --- |
| `sky_2027_2066.bin` | fünf float32-Reihen der Länge 350.641 hintereinander: Länge und Breite des Punkts unter der Erde, Länge und Breite des Punkts unter der Sonne, Erdentfernung in km |
| `data/globe/ldem_me_1440x720.bin` | int16, Stufe 0,5 m, Zeile 0 im Norden, Spalte 0 bei −180° |
| `data/globe/horizon_720x360x24.bin` | uint8, 24 Schichten (je 15° Azimut), Grad = −6 + Wert / 255 · 36 |
| `data/exposure/*_2027_720x360.bin` | uint8, Wert / 255 = mittlerer Scheibenanteil |
| `data/terrain/<id>.bin` | Geländeblock „LTIL“ Version 3: 64 Byte Kopf (Mitte als float64, Bezugssystem, Größe der Quellpixel), Nahraster 640 × 640 uint16 über 250 km, Fernraster 601 × 601 uint16 bis 300 km. 1,54 MB |
| `horizon_site0X.json` | je 360 Werte Winkel, Entfernung des bestimmenden Hindernisses, Winkelunsicherheit; Zielpunkt, Methode, Quellen |

Jede Datendatei hat eine Beschreibungsdatei (`.json`) mit Aufbau, Bezugssystem, Quelle und Prüfsumme.

### 7.3 Start

- **Windows:** `start.bat`. **Sonst:** `python tools/serve.py --open`. Die Seite läuft unter `http://127.0.0.1:8080/`. Ein Doppelklick auf `index.html` geht nicht, weil die Seite Dateien nachlädt.
- **Statisch (GitHub Pages):** Ordner veröffentlichen. Die neun Plätze und der Demo-Platz öffnen in voller Auflösung, jeder andere Punkt mit grobem Gelände und Hinweis.
- **Gelände für jeden Punkt:** lokaler Server mit `numpy`, `rasterio` und dem TIF im Repo-Ordner. Der Server schneidet einen Block in 1 bis 2 s (`/api/terrain?lat=&lon=`) und legt ihn in `cache/terrain/` ab.
- **Schalter in der Adresse:** `?detail=light` (leichteres Mondnetz), `?demo=auto` (Demo läuft von selbst, für Aufnahmen).
- **Voraussetzungen:** Browser mit WebGL und Modul-Workern; Python 3.10 oder neuer für den Server; Node 20 oder neuer für die Tests.
- **Leistung:** Die Seite zeichnet immer das volle Mondnetz (rund 2 Mio. Dreiecke) und schaltet nicht selbst herunter. Die Bildrate ist nur auf Lennis Rechner angesehen, nicht gemessen. Für schwache Grafik gibt es `?detail=light`.

### 7.4 Daten neu erzeugen

    python tools/build_globe.py       (braucht das TIF)
    python tools/build_terrain.py     (braucht das TIF)
    node   tools/build_horizon.mjs    (aus dem Globusraster)
    python tools/build_exposure.py    (nur numpy, rund 3 Minuten)
    python tools/check_frames.py      (braucht TIF und 80-m-Polmodell)
    node --test

Himmelstabelle und 5-m-Profile: `expiry-date/tools/build_sky.py` und `build_horizon.py`.

## 8. Prüfung

### 8.1 Was geprüft ist

| Prüfung | Ergebnis | Am 15.11. wiederholt |
| --- | --- | --- |
| `node --test`: 27 Prüfungen der Seite, 10 des Vorläufers | 37 von 37 bestanden | ja |
| Himmel gegen Horizons-Beobachtertabellen: 3 Orte (Südpol, mittlere Breite, Äquator), 3 Termine, Sonne und Erde | größte Abweichung 0,0054° (Ziel 0,1°) | ja (Teil der Tests) |
| Umrechnung ME nach PA: LDEM64 gegen das 80-m-Polmodell, 20.000 Punkte, 82° bis 89,5° S | RMS 5,7 m mit Umrechnung, 91 m ohne, 177 m mit der umgekehrten | nein (braucht die Rohdaten) |
| Scheibenanteile gegen die unabhängige Rechnung des Vorläufers | Unterschied unter 0,0001 | ja (Teil der Tests) |
| Horizont Connecting ridge, LDEM64-Block gegen 5-m-Profil | im Mittel 0,32°, größte Abweichung 1,56° | ja |
| Fläche gegen Einzelpunkt-Rechnung auf demselben Horizont, 80 Zellen, 24 h bis 60 Tage | unter 0,02 h | ja (Teil der Tests) |
| Verzug je Tag gegen `spanMetrics` für dasselbe Fenster | gleich | ja (Teil der Tests) |
| Geländekarten: Horizont am Platz gegen den fein gerechneten; Mittelwert gegen die Einzelpunkt-Reihe | unter 0,25°; unter 0,2 Prozentpunkten | ja (Teil der Tests) |
| Glatte Kugel als Gegenprobe für die Geländekarten | Horizont −0,087° (die Kimmtiefe aus 2 m Höhe), 50 % Sonne im Jahr | ja (Teil der Tests) |
| Horizons-Werte des früheren Viewers gegen die Tabelle, 8.761 Stunden 2027 | Sonne bis 0,068°, Erde bis 0,062° | nein |
| Demo: alle 24 Schritte im Browser auf Lennis Rechner | ohne Konsolenfehler; Schritte 20 bis 24 nach den letzten Änderungen nicht erneut | nein |

Die Prüfungen sichern drei Dinge: dass der Himmel stimmt, dass die Bezugssysteme zusammenpassen, und dass alle Teile der Seite dieselbe Rechnung benutzen. Sie sichern **nicht,** dass das Ergebnis mit der Wirklichkeit übereinstimmt (8.3).

### 8.2 Nachrechnung am 15.11.

Mit den Modulen aus `core/` im Commit `4fe00c9`, in Node, Horizons-Tabelle, stündlich.

**Jahr 2027, 01.01. bis 01.01.**

| Platz | Grundlage | Sonne in Sicht | Längste Dunkelphase | Erde in Sicht | Längste Funklücke |
| --- | --- | --- | --- | --- | --- |
| Connecting ridge | 5-m-Profil | 87,9 % | 246 h | 50,8 % | 321 h |
| | 5-m-Profil, Horizont −1σ bis +1σ | 89,7 % bis 86,1 % | 194 h bis 301 h | | |
| | LDEM64-Block | 91,0 % | 99 h | 50,8 % | 321 h |
| | glatte Kugel | 52,0 % | 3.950 h | 45,2 % | 361 h |
| Shackleton rim | 5-m-Profil | 83,9 % | 119 h | 49,5 % | 334 h |
| | LDEM64-Block | 83,9 % | 75 h | 49,4 % | 335 h |
| | glatte Kugel | 54,2 % | 4.010 h | 46,2 % | 355 h |

Lesart: Das Gelände ändert die Aussage grundlegend (52 % gegen 88 % Sonne), weil ein Grat über die Umgebung hinausschaut. Der LDEM64-Block trifft Anteile gut, die längste Dunkelphase an Graten aber nicht (99 h gegen 246 h).

Zur Zeile ±1σ: Das Profil wurde in allen Richtungen gemeinsam um die Winkelunsicherheit aus der Profildatei gesenkt oder gehoben. Ein tieferer Horizont gibt mehr Sonne. Die Spanne von 194 bis 301 h zeigt, wie empfindlich die längste Dunkelphase selbst am besten Gelände ist.

Das Skript der Nachrechnung liegt nicht im Repo. Die Zahlen lassen sich mit `makeSite`, `horizonFromProfile`, `horizonFromBlock` und `spanMetrics` aus `core/visibility.js` und `delayTable` aus `core/delay.js` wiederholen.

**Verzug:** Landung 07.07.2028, 10 Tage, Grenzen 6 h und 12 h, 5-m-Profile: Connecting ridge „holds for 5 days of delay“, Shackleton rim 0 Tage.

**Demo-Platz:** Abschnitt 10.1.

### 8.3 Was nicht geprüft ist

- Vergleich gerenderter Schatten oder gerechneter Beleuchtung mit datierten LROC-Bildern oder der QuickMap-Beleuchtungskarte.
- Vergleich mit Literatur. Ein anderes Team nennt in seinem README für den Connecting ridge 92,29 % Beleuchtung in 2 m Höhe gegen veröffentlichte 92,27 % bei Gläser et al. (2014); unser 5-m-Profil ergibt für 2027 87,9 %. Mögliche Gründe: anderer Punkt, ein Jahr statt 18,6 Jahre, 50-%-Regel statt „irgendein Teil der Scheibe“. Ungeklärt.
- Bildrate auf verschiedener Grafikhardware.
- Die Seite auf GitHub Pages im Browser.
- Schmale Fenster, Hochformat, Touch, `prefers-reduced-motion`.
- Ein Test mit unbeteiligten Personen.

## 9. Annahmen und Grenzen

| Nr. | Annahme oder Grenze | Wirkung |
| --- | --- | --- |
| 1 | Ergebnisse sind Punktwerte für einen Empfänger 2 m über Grund | Keine Aussage über eine Landeellipse; an Graten entscheidet die Lage auf wenige hundert Meter |
| 2 | „In view“ ab 50 % der Scheibe | Arbeiten, die jeden sichtbaren Teil der Scheibe zählen, kommen auf höhere Beleuchtungsanteile als wir |
| 3 | Der Horizont gilt über die Breite der Scheibe als gerade Linie in Höhe des Profils im Azimut der Scheibenmitte | Bei der Erde (1,9° breit) kann das Profil über diese Breite merklich steigen oder fallen; der Fehler ist nicht beziffert |
| 4 | Die Sonnenrichtung gilt für den ganzen Mond, zwischen den Stunden wird linear interpoliert | Klein: Der Gesamtfehler gegen Horizons liegt an 18 Vergleichspunkten bei höchstens 0,0054° |
| 5 | LDEM64-Block: Gelände näher als 0,95 km gilt als offen | Abgestimmt nur am Connecting ridge. Dort ergibt ein Abstand von 0,12 bis 1,42 km eine längste Dunkelphase von 422 bis 99 h (Referenz 246 h; Zahlen des Validity-Jurors). Für freie Punkte an Polgraten ist der Wert eher zu günstig |
| 6 | „5 m“ ist die Rasterweite der Platzmodelle, nicht ihre Messdichte | Laut Projektkonzept sind rund 90 % der 5-m-Pixel zwischen den Laserspuren interpoliert; an der Quelle nicht nachgeprüft |
| 7 | Umland bis 300 km | Gelände jenseits davon müsste den Standort um mehr als 26 km überragen, um über dessen Horizontale zu kommen; das gibt es auf dem Mond nicht. Es fehlt aber Gelände, das von einem Gipfel aus einen unter der Horizontalen liegenden Horizont noch anhebt |
| 8 | Fläche, globale Karten und Schatten der Systemansicht nutzen das 7,6-km-Raster | Nur große Formen; kleine Krater und Grate fehlen. In der Demo gilt das für alle Flächenanteile |
| 9 | Stündliche Stichprobe, lineare Interpolation | Feinere Schritte ändern die längste Dunkelphase um 0,01 h (Validity-Juror) |
| 10 | Grenzen für Dunkelheit und Funklücke | Setzungen des Teams, auf der Seite so gekennzeichnet |
| 11 | Erdsicht ist Geometrie | Keine Funkstrecke, keine Bodenstation, kein Relais |
| 12 | Keine Temperatur, kein Energiemodell | „6 h Batterie“ in der Demo ist eine Erzählannahme |
| 13 | 5-m-Profile: Fehler im Umland mit 3 m angenommen, Abstandsuntergrenze 100 m für die Winkelunsicherheit | Die Spanne ±1σ verschiebt alle Richtungen gemeinsam; sie ist kein Vertrauensbereich |
| 14 | Unsicherheit wird nur in der Datei geführt | Die Karte zeigt einen Wert ohne Spanne |
| 15 | Analytisches Modell außerhalb 2027 bis 2066 | Erde bis rund 0,4° daneben; am Pol kann das eine Erdsicht umkehren |
| 16 | Die 200-km-Quadrate sind eine Ebene zum Ansehen | Sie lassen 0,12 % der Oberfläche aus, darunter beide Pole |

## 10. Demo und Tutorial

### 10.1 Landeplatz und Zahlen der Demo

Der Platz ist ein freier Punkt, kein gelisteter: **88,9481° S, 75,048° E**, eine Ebene 32 km vom Südpol, 790 m unter der Bezugskugel. Er wurde am 15.11. mit `core/` in Node gesucht: voll beleuchtet und mit Erdsicht am Landetag und in den zehn Tagen danach, 90 Tage später dunkel, und dann möglichst lange dunkel. Seine Zahlen beruhen auf dem LDEM64-Block (`data/terrain/demo.bin`), demselben Gelände, das die Geländeansicht zeichnet.

| Größe | Wert | Am 15.11. nachgerechnet |
| --- | --- | --- |
| Geplante Landung | 07.11.2027, 12:00 UTC: Sonne 2,60° hoch, Horizont in dieser Richtung 2,09°; Erde in Sicht | ja |
| Zehn Tage danach | 240 h Sonne, keine Funklücke | ja |
| Landung nach Verzug | 05.02.2028, 12:00 UTC: Sonne 0,68° hoch, Horizont in dieser Richtung 2,04°, Scheibe 0 % sichtbar; Erde in Sicht | ja |
| Dunkel seit | 13.01.2028, 21:00 UTC | ja |
| Licht zurück | 01.08.2028, 12:32 UTC | ja |
| Wartezeit ab Landung | 4.273 h = 178 Tage; ganze Dunkelphase 201 Tage | ja |
| Vergleichsplatz | Shackleton rim, 36 km entfernt, am 05.02.2028 in der Sonne | Entfernung ja |
| Anteile der Mondoberfläche innerhalb 6 h und 12 h ab 05.02.2028 | 24 h: 47 % (Sonne), 49 % (Erde), 31 % (beides); 10 Tage: 17 %; 30 Tage: 0 % | nein (aus dem Durchlauf der Seite) |

Die Demo liest diese Zahlen beim Lauf aus der Rechnung der Seite. Fest im Text stehen nur: 384.400 km mittlere Mondentfernung, 32 km zum Pol, 1,5° Achsneigung, 7,6 km Raster und die Aussage zur glatten Kugel.

### 10.2 Ablauf

24 Schritte in fünf Kapiteln; weiter mit „Next“, Pfeiltasten oder Leertaste, Ende mit Esc oder „Skip demo“.

| Kapitel | Schritte | Inhalt |
| --- | --- | --- |
| The plan | 1 bis 4 | Erde, Flug zum Südpol, Landeplatz, Landetag mit Sonne und Erde |
| The slip | 5 bis 7 | 90 Tage Verzug, derselbe Platz dunkel (Kernschritt, rot markiert), Zähler bis 4.273 h |
| The system | 8 bis 18 | Erde steht, Sonne wandert; Vorderseite; Rand und Pole; zwei Grenzen und ihre Fläche über 24 h, 10 und 30 Tage |
| The terrain | 19 bis 23 | Höhenkarte, Schatten erreichen den Platz, Karten für Sonne und Erde über 10 Tage, Vergleich mit Shackleton rim |
| Your turn | 24 | „Start the tutorial“ oder „Explore freely“ |

Die Demo hat keine eigenen Modelle. Jeder Schritt stellt Uhr, Kamera, Oberfläche, Grenzen und Zeitspanne der echten Seite ein. Der gezeichnete Weg von der Erde zum Mond und das Lander-Modell sind eine Skizze, keine gerechnete Flugbahn und kein bestimmtes Raumfahrzeug.

### 10.3 Befund zum Text von Schritt 23

Der Schritt trägt die Überschrift „The cause is terrain, not season.“ und sagt: „On a smooth Moon the site would be lit today. The surrounding terrain shades it for 201 days.“

Nachrechnung auf glatter Kugel am selben Punkt:

| Zeitraum | Glatte Kugel | Mit Gelände |
| --- | --- | --- |
| 05.02.2028 | beleuchtet | dunkel |
| 09.02. bis 04.03.2028 | dunkel (23,4 Tage) | dunkel |
| 05.03. bis 26.06.2028 | dunkel (112,9 Tage) | dunkel |
| 13.01. bis 01.08.2028 gesamt | 17,7 % der Zeit beleuchtet | durchgehend dunkel (201 Tage) |
| Jahr 2028 | 50,5 % beleuchtet, längste Dunkelphase 2.709 h | 20,2 % beleuchtet, längste Dunkelphase 4.816 h |

Der erste Satz stimmt für den 5. Februar. Die Überschrift stimmt nicht: Auch ohne Gelände wäre der Platz vier Tage später für 23 Tage und danach für 113 Tage dunkel. Die Jahreszeit erklärt den größeren Teil der Dunkelheit; das Gelände nimmt die verbleibenden Lichtphasen weg und verlängert die längste Dunkelphase von 113 auf 201 Tage. Vorschlag für den Text: „Terrain and season together. On a smooth Moon the site would still be lit today. The surrounding terrain turns 113 days of winter darkness into 201.“

### 10.4 Tutorial

Zwölf Stopps in drei Kapiteln an den echten Bedienelementen; die Seite bleibt bedienbar.

| Kapitel | Stopps |
| --- | --- |
| Basics | Was sehe ich? · Wann läuft meine Mission? · Wo lande ich? · Was sagt die Karte? |
| Mission limits | Wie lange ohne Sonne? · Wie lange ohne Funk? · Warum bleibt bei längerer Mission weniger? · Was, wenn der Start rutscht? |
| The analysis | Was geschieht in den nächsten Wochen? · Welcher Platz ist besser? · Warum ist es hier dunkel oder hell? · Wo in der Nähe ist es besser? |

Jeder Stopp hat eine Frage, eine Antwort in zwei bis drei Sätzen, eine Handlung („Try it“, wird abgehakt; „Show me“ führt sie vor), das Beobachtete (aus der Seite gelesen, keine feste Zahl) und einen Hinweis auf die Stelle, die man leicht falsch liest. Das Blatt „Reference“ listet alle übrigen Bedienelemente, die Definitionen und die Quellen.

## 11. Verlauf und Entscheidungen

| Datum | Schritt | Dokument |
| --- | --- | --- |
| 13.11. | Rechenkonzept: Horizons für den Himmel, LOLA für das Gelände, Horizontprofil statt Strahlen je Zeitschritt | `Rechenkonzept_JPL_Horizons.md` |
| 14.11. vormittags | Konzept „Expiry Date“: Verzugsstreifen je Platz, grün oder rot | `Projektkonzept_Expiry_Date.md` |
| 14.11. nachmittags | Himmelstabelle und zwei 5-m-Profile gebaut und geprüft; Werkzeug `expiry-date/` läuft | `Arbeitsumgebung.md` |
| 14.11. | Score „Mission Return“ entworfen | `Vergleichslogik_Mission_Return.md` |
| 14.11. abends | Schattenkonzept für die 3D-Ansicht; Designregeln | `Schattenkonzept_Randverdeckung.md`, `Designregeln_Frontend.md` |
| 15.11. nachts | Frontend und Backend-Viewer zu einer Seite zusammengeführt | `Integrationskonzept_Frontend_Backend.md` |
| 15.11. mittags | Jury-Review; Vergleich mit anderen Teams; `expiry-date/` gilt als Artefakt der Entwicklung | `Jury_Review_Integration.md`, `Vergleich_andere_Umsetzungen.md` |
| 15.11. nachmittags | Flächenfilter, Geländekarten, Zeile „Terrain data“, Verzugszeile, „Sky view“, Tabelle, Demo, Tutorial, Wortlaut, Name L.U.N.A. | übrige Dokumente |

**Entscheidungen, die das Produkt prägen**

- Eine Seite, ein Renderer, eine Uhr, zwei Szenen.
- Gelände wird um den markierten Punkt geschnitten, nicht nach einem Kachelraster.
- Alles in MOON_ME; die Umrechnung nach MOON_PA geschieht nur beim Lesen des Rasters.
- Ein Körper gilt ab 50 % der Scheibe als in Sicht.
- Daten als Dateien nachladen, keine Live-Abfrage bei Horizons.
- Im Zweifel nach wissenschaftlichem Standard.

**Verworfen oder nicht gebaut**

| Was | Warum |
| --- | --- |
| „Mission Return“ mit Batterie und Datenpuffer | Nicht umgesetzt; die Seite bleibt bei Geometrie und zwei Grenzen |
| Gewichteter Index, Minimum aus Strom und Funk | Willkürliche Gewichte oder keine physikalische Einheit |
| Horizontkarte mit Ankergitter und Shader (Schattenkonzept) | Nicht in dieser Form gebaut; die Geländeansicht nutzt die Schattenkarte der Grafikkarte mit Umland, die Systemansicht die Skyline-Karte |
| Kachelraster als Adresse für Gelände | Lässt beide Pole aus |
| Kamera auf Bodenhöhe in der Demo | Aufwand |

## 12. Stand von Repo und Abgabe

Stand der Angaben: lokaler Klon und die GitHub-Seite des Repos, abgerufen am 15.11. zwischen 17:50 und 18:00 Uhr. Laut Projektkonzept ist die Abgabe am 15.11. um 21:00 Uhr geplant, mit Puffer bis 23:59 Uhr. Für diese Dokumentation wurde am Repo nichts geändert.

| Punkt | Stand |
| --- | --- |
| Fertiger Code | Branch `integration`, Commit `4fe00c9` („Guided demo in 24 steps, title page with Demo and Tutorial, scene support for both“), auf GitHub gepusht |
| `main` auf GitHub | **Älterer Stand:** README „Lunar Communication Guardian — Collaborative Workflow Editor“, keine `LICENSE`, kein `core/`, `view/`, `tools/`, `tests/`. `integration` ist nicht nach `main` geführt |
| Repo | öffentlich; Standardbranch `main` |
| Öffentliche Seite | Im Repo ist `timbelom.github.io/TerraBitsHackathon/` eingetragen. Die Adresse ließ sich bei der Prüfung nicht laden; welcher Stand dort liegt, ist offen |
| Lizenz | MIT, nur auf `integration` |
| Tests | 37 von 37 auf `integration` |
| Video, Projektseite der Challenge | Im Repo und in den Arbeitsdokumenten nicht belegt |
| Bewertung nach den Kriterien der Challenge | Das simulierte Jury-Review vom 15.11. mittags (2 bis 4 von 5 Punkten je Kriterium) galt einem früheren Stand, vor Verzugszeile, Tabelle, „Sky view“, Demo und Tutorial. Es ist nicht wiederholt |

## 13. Offene Punkte

**A. Vor der Abgabe**

- **A1.** `integration` nach `main` führen (oder Pages auf `integration` stellen) und die öffentliche Seite in einem privaten Fenster prüfen: lädt, neun Plätze und Demo-Platz mit vollem Gelände, Fläche und Geländekarten laufen. Hosting und Auslieferung stehen auf der Seite unter der Rolle „Product Delivery & Operations“.
- **A2.** Demo, Schritt 23: Überschrift und Satz anpassen (10.3).
- **A3.** Video und Projektseite: Stand klären; die Kernzahlen dafür stehen in 8.2 und 10.1.
- **A4.** README des Repos nachziehen: Titel nennt noch „TerraBits: Lunar Landing Site Navigator“ statt L.U.N.A.; „22 checks“ statt 37; in der Dateitabelle fehlen `core/area.js`, `core/delay.js`, `core/exposure.js`, `landing-compare.js`, `landing-sky.js`, `landing-area.js`, `landing-exposure.js`, `view/relief.js`, `tools/build_horizon.mjs`; Begriffe „Mean sunlight“ und „Earth in view“ statt der Begriffe der Seite.
- **A5.** Quelle der Erdtextur nachtragen oder die Textur ersetzen.

**B. Inhaltlich offen**

- **B1.** Abgleich mit einem datierten LROC-Bild oder der QuickMap-Beleuchtungskarte an mindestens einem Südpolplatz.
- **B2.** Connecting ridge gegen Gläser et al. (2014) klären.
- **B3.** Abstand 0,95 km an weiteren Plätzen prüfen oder die Spanne auf der Karte nennen.
- **B4.** Unsicherheitsspanne der 5-m-Profile auf der Karte zeigen.
- **B5.** Name der Oberfläche „DTE availability“: Gezeigt wird der mittlere Scheibenanteil, nicht der Anteil der Stunden.
- **B6.** Titeltext „We ray-trace the Sun and the Earth“: Die Rechnung verfolgt Strahlen durch das Gelände einmal je Punkt, um den Horizont zu bilden, und vergleicht danach nur noch Winkel.
- **B7.** Aufgabe am Ende des Tutorials (6 h, 12 h, 10 Tage, zwei Wochen Verzug): Es ist nicht belegt, dass es einen Platz gibt, der sie erfüllt.
- **B8.** Kein Test mit unbeteiligten Personen, weder Fachleute noch Lernende.

**C. Pflege**

- **C1.** Kommentar am Kopf von `landing-demo.js` nennt noch Connecting ridge als Landeplatz.
- **C2.** Analytisches Modell: Kommentar nennt 0,34°, gemessen bis 0,40°.
- **C3.** Zahlen- und Datumsformat zwischen Seite und Demo vereinheitlichen.
- **C4.** Im Arbeitsordner liegen nicht versionierte Reste (`.transfer/` 180 MB, `cache/` 173 MB, `tiles/` 14 MB).
- **C5.** Lizenz des Sternkatalog-Repos prüfen.

## 14. Review dieser Dokumentation in drei Rollen

Die drei Rollen hat Claude selbst eingenommen, nacheinander, am ersten vollständigen Entwurf dieses Dokuments. Das sind keine unabhängigen Personen und kein Ersatz für eine Durchsicht durch das Team. Runde 1 nennt die Befunde und was daraufhin geändert wurde, Runde 2 das Urteil am überarbeiteten Text.

### 14.1 Runde 1: Befunde

**Leiter-Reviewer** (Frage: Weiß ich nach fünf Minuten, was fertig ist, was fehlt und was vor der Abgabe zu tun ist?)

| Befund | Geändert |
| --- | --- |
| Die Kurzfassung sagte nicht, ob das Produkt abgabefertig ist | „Stand in einem Satz“ in Abschnitt 1 |
| Team und Rollen fehlten | In Abschnitt 1 ergänzt, wie auf der Seite angegeben |
| Abgabetermin fehlte; unklar, ob für die Doku am Repo etwas geändert wurde | Abschnitt 12 |
| Das Jury-Review vom Mittag stand unkommentiert im Raum | Abschnitt 12: galt einem früheren Stand, nicht wiederholt |
| Offene Punkte ohne Reihenfolge nach Dringlichkeit | Abschnitt 13 in A, B, C geteilt; Video und Projektseite aufgenommen |
| Leistung und Systemanforderungen fehlten | Abschnitt 7.3 |
| Arbeitsdokumente tragen überholte Vermerke („nicht committet“) | Abschnitt 16 mit Status je Dokument |

**Scientist** (Frage: Kann ich jede Zahl nachvollziehen, und steht bei jeder Aussage, worauf sie beruht?)

| Befund | Geändert |
| --- | --- |
| Formel für den Horizont ohne Erklärung der Größen | Abschnitt 5.3 |
| Unklar, was die Prüfung gegen Horizons belegt: Beide Seiten stammen aus Horizons | Abschnitt 5.2 |
| Die Vereinfachung „gerade Horizontlinie über die Scheibe“ war nicht als Grenze genannt | Abschnitt 9, Nr. 3 |
| „5 m“ wurde wie eine Messauflösung gelesen | Abschnitt 9, Nr. 6 |
| DE421 (LOLA) gegen DE441 (Horizons) nicht erwähnt | Abschnitt 5.1, als nicht beziffert |
| Zeile ±1σ ohne Angabe, wie sie gerechnet ist; Nachrechnung nicht wiederholbar beschrieben | Abschnitt 8.2 |
| Sonnenhöhe am Pol zu pauschal („nie höher als 1,5°“, „steigt und sinkt um 1,5°“) | Abschnitt 4.3 |
| „Keine Dämmerung: entweder hell oder dunkel“ widerspricht dem Scheibenanteil | Abschnitt 4.2 |
| Skyline-Karte: Wertebereich und Abschneiden fehlten | Abschnitt 5.7 |
| Demo, Schritt 23: Aussage „terrain, not season“ hält der Nachrechnung nicht stand | Abschnitt 10.3, mit Tabelle und Textvorschlag; im Produkt nicht geändert |

**Educator** (Frage: Kann ich das jemandem ohne Vorwissen erklären, und was mache ich damit im Unterricht?)

| Befund | Geändert |
| --- | --- |
| „Horizontale“ und „Horizont“ wurden ohne Erklärung nebeneinander benutzt | Abschnitt 4.2, Glossar |
| Kurzfassung setzte „LDEM64-Block“ und „5-m-Profil“ voraus | Abschnitt 1 umformuliert |
| Aufgaben ohne erwartetes Ergebnis | Abschnitt 4.6; für Aufgabe 3 offen benannt, dass keine geprüfte Lösung vorliegt |
| Typische Fehlvorstellungen fehlten | Abschnitt 4.5 |
| Die Geschichte der Demo ließ sich mit der falschen Ursache weitererzählen | Hinweis in Abschnitt 4.4 |
| Englische Oberfläche, keine deutschen Entsprechungen | Abschnitt 15, zweite Tabelle |
| Praktische Voraussetzungen im Klassenraum fehlten | Abschnitt 4.6 |

### 14.2 Runde 2: Urteil

| Rolle | Mit der Dokumentation zufrieden? | Was bleibt |
| --- | --- | --- |
| Leiter-Reviewer | Ja. Stand, Lücken und nächste Schritte sind ohne Rückfrage lesbar | Die offenen Punkte haben keine Verantwortlichen und keine Termine; das kann nur das Team setzen. Für die Jury zählt das englische README im Repo, nicht dieses Dokument; das README ist an mehreren Stellen überholt (13, A4) |
| Scientist | Ja, mit Vorbehalt. Methode, Quellen, Annahmen und Prüfungen sind vollständig und ehrlich beschrieben | Die Doku kann die fehlende Prüfung gegen die Wirklichkeit nicht ersetzen (13, B1 und B2). Drei Größen sind nur als „nicht beziffert“ geführt: gerade Horizontlinie, DE421 gegen DE441, abgeschnittene Werte der Skyline-Karte. Die Umrechnung ME nach PA und die Flächenanteile der Demo sind am 15.11. nicht wiederholt, sondern übernommen |
| Educator | Ja für Lehrende als Hintergrund. Nein als Material für Lernende | Keine Abbildungen in diesem Dokument. Aufgabe 3 hat keine belegte Lösung. Niemand ohne Vorwissen hat Seite oder Text getestet. Die Oberfläche ist englisch |

**Gesamturteil.** Die Dokumentation ist vollständig in dem Sinn, dass zu jeder Funktion steht, was sie tut, wie sie rechnet, woher ihre Daten kommen und wie weit sie geprüft ist. Unzufrieden bleiben alle drei Rollen mit Dingen, die außerhalb der Dokumentation liegen: der öffentliche Stand (Leitung), der fehlende Abgleich mit Bildern oder Literatur (Wissenschaft), der fehlende Test mit Lernenden (Lehre).

## 15. Glossar

| Begriff | Bedeutung |
| --- | --- |
| Azimut | Himmelsrichtung als Winkel, von Nord über Ost gezählt |
| Bezugskugel | Kugel mit 1.737,4 km Radius; Höhen sind Abstände von ihr |
| Block | Datei mit dem Gelände um einen Punkt (250 km fein, 300 km grob) |
| DTE, direct-to-Earth | Funk direkt zur Erde, ohne Relais; hier nur die freie Sichtlinie |
| Elevation | In der Seite zweierlei: Geländehöhe in Metern („Elevation, LOLA“) und Höhenwinkel eines Körpers („Solar elevation“) |
| Geländehorizont, terrain horizon | Die Linie, die das Gelände am Himmel zieht, in 360 Richtungen |
| Horizons | Dienst des NASA JPL für Positionen von Himmelskörpern |
| Horizontale | Die waagerechte Ebene am Standort, Höhenwinkel 0° |
| „In view“ | Mindestens die halbe Scheibe steht über dem Geländehorizont |
| Kimmtiefe | Winkel, um den der Horizont einer glatten Kugel unter der Horizontalen liegt, wenn man erhöht steht; aus 2 m Höhe auf dem Mond 0,087° |
| LDEM64 | LOLA-Höhenraster des ganzen Mondes, 64 Pixel je Grad, 474 m |
| Libration | Das leichte Pendeln des Mondes, durch das die Erde am Mondhimmel einige Grad wandert |
| LOLA | Lunar Orbiter Laser Altimeter auf der NASA-Sonde LRO |
| Mondtag, lunar day | 29,53 Erdtage von Sonnenaufgang zu Sonnenaufgang |
| MOON_ME, MOON_PA | Zwei Koordinatensysteme des Mondes; sie unterscheiden sich um bis zu 875 m am Boden |
| PGDA | Planetary Geodesy Data Archive des NASA GSFC; Quelle der LOLA-Produkte |
| Punkt unter der Sonne, sub-solar point | Ort auf dem Mond, über dem die Sonne senkrecht steht; entsprechend für die Erde |
| Scheibenanteil | Sichtbarer Teil der Sonnen- oder Erdscheibe, 0 bis 100 % |
| Skyline-Karte | Horizont für jede 0,5°-Zelle des Mondes in 24 Richtungen, aus dem groben Raster |
| Zeitspanne, time span | Start bis Stop der Zeitleiste; steht für die Mission |

**Beschriftungen der Seite auf Deutsch**

| Auf der Seite | Deutsch |
| --- | --- |
| Illuminated | Anteil der Stunden mit mindestens halber Sonnenscheibe in Sicht |
| Longest darkness | Längste zusammenhängende Zeit ohne Sonne |
| DTE available | Anteil der Stunden mit mindestens halber Erdscheibe in Sicht |
| Longest DTE outage | Längste zusammenhängende Zeit ohne Erdsicht |
| Max. darkness, Max. DTE outage | Grenzen, die der Nutzer für die beiden Lücken setzt |
| Solar elevation | Höhenwinkel der Sonnenmitte über dem Geländehorizont |
| Sun’s disk in view, Earth’s disk in view | Sichtbarer Anteil der Scheibe |
| Terrain data | Geländegrundlage des Horizonts |
| Shaded relief, Imagery, Elevation | Schattiertes Relief, Bildmosaik, Geländehöhe |
| Mean illumination, DTE availability | Mittlerer sichtbarer Anteil der Sonnen- und der Erdscheibe |
| holds for N days of delay | Der Platz hält N Tage Verzug der Landung aus |
| View terrain | Geländeansicht öffnen |
| Compare as table | Offene Karten als Tabelle |

## 16. Status der Arbeitsdokumente

| Dokument | Status |
| --- | --- |
| `Rechenkonzept_JPL_Horizons.md` | Historisch. Grundidee gilt; Abfrageform, Kartenraster und offene Fragen sind überholt. Die Angabe, SLDEM2015 decke den ganzen Mond ab, ist falsch (im Schattenkonzept korrigiert); genutzt wird LDEM64 |
| `Projektkonzept_Expiry_Date.md` | Historisch. Beschreibt den Vorläufer; Regel, Profile und Abgabeplan gelten nicht mehr. Koordinatentabelle überholt (maßgeblich: `sites.json`) |
| `Vergleichslogik_Mission_Return.md` | Nicht umgesetzt |
| `Schattenkonzept_Randverdeckung.md` | Entwurf, in dieser Form nicht gebaut; die Geometrie (Krümmung, negativer Horizont, Scheibenanteil) ist in `core/` umgesetzt |
| `Designregeln_Frontend.md` | Regeln gelten. Tabelle der Designwerte überholt: Im Code ist die Akzentfarbe fast weiß, die Flächen sind halb durchsichtig; die Sidebar ist kein Platzhalter mehr |
| `Arbeitsumgebung.md` | Teilweise überholt: Branch-Stände, Zahl der Tests, Altdateien (jetzt in `legacy/`). Starten, Ordner und Zugriff gelten |
| `Integrationskonzept_Frontend_Backend.md` | Gilt für Architektur und Messungen bis 15.11. morgens. Überholt: Die Seite schaltet nicht mehr selbst auf das leichtere Netz; Schatten der Systemansicht kommen aus der Skyline-Karte |
| `Jury_Review_Integration.md` | Befunde 1 bis 3 und 5 sind behoben (Einstieg, Tabelle mit Urteil, Zeile „Terrain data“, DTE ausgeschrieben, Annahmen gekennzeichnet); Befund 4 teilweise (die Erde erscheint in „Sky view“, nicht in „Solar elevation“); Befund 6 (Abgabe) und die Validity-Befunde gelten weiter |
| `Vergleich_andere_Umsetzungen.md` | Gilt als Momentaufnahme; die Punkte 1 bis 4 und 6 der Empfehlung sind umgesetzt, 5 (öffentlicher Link, Projektseite, Video) ist offen, 7 und 8 sind nicht umgesetzt |
| `Flaechenfilter_Grenzen.md` | Gilt |
| `Heatmaps_Gelaendeansicht.md` | Gilt; die Namen der Oberflächen lauten jetzt „Mean illumination“ und „DTE availability“ |
| `Demo_Story_Vorschlag.md` | Abgelöst durch `Demo_Animationsstruktur.md` |
| `Implementation_Plan_Abgabe.md` | Abgearbeitet: A bis E, J umgesetzt; I (Link zum Teilen) und K (Gläser) nicht; F bis H siehe Abschnitt 12 |
| `Demo_Animationsstruktur.md` | Gilt für Ablauf und Zahlen; Texte und Lage des Textfelds durch `Demo_Textgestaltung.md` abgelöst; committet |
| `Startseite_Layout.md` | Gilt; committet |
| `Tutorial_Sketch.md` | Abgelöst durch `Tutorial_Umsetzung.md` |
| `Tutorial_Umsetzung.md` | Gilt; committet |
| `Demo_Textgestaltung.md` | Gilt; committet |
| `Glossar_UI_Begriffe.md` | Gilt; offene Punkte dort bestehen weiter |

Hinweise: Mehrere Arbeitsdokumente vom 15.11. tragen den Vermerk „nicht committet“. Das ist überholt; der Arbeitsordner ist sauber, alles liegt in `4fe00c9` oder davor. Einige Uhrzeiten in den Arbeitsdokumenten vom Nachmittag des 15.11. gehen rund eine Stunde vor (ein Dokument nennt Prüfungen um 18:15 Uhr für Code, der um 17:29 Uhr MEZ committet wurde).

## 17. Quellen

- [Challenge: Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) · [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [PGDA Produkt 95: LOLA MOON_PA gridded dataset](https://pgda.gsfc.nasa.gov/products/95)
- [PGDA Produkt 78: LOLA-5-m-Modelle der Südpolplätze](https://pgda.gsfc.nasa.gov/products/78)
- [PGDA Produkt 90: 80-m-Polmodell](https://pgda.gsfc.nasa.gov/products/90)
- Barker et al. (2023), Planetary Science Journal 4, 183
- [NSSDCA: Apollo Landing Site Coordinates](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html) · [NSSDCA: Spacecraft on the Moon](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html)
- [NAIF: Lunar frame kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/a_old_versions/moon_de440_220930.tf)
- Repo: https://github.com/Timbelom/TerrabitsHackathon (Branch `integration`)
