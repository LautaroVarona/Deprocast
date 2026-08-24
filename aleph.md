# Aleph — motor espacial de Deprocast

```
documento   : aleph.md
módulo      : Aleph
versión     : 0.1.0 (Fase 1)
fecha       : 2026-08-24
```

Aleph es el **lienzo de escalas** del OS: un punto desde el que se puede orbitar y hacer zoom logarítmico, de un orrery simplificado (estrellas, Mercurio, Tierra) hasta un cuerpo humano procedural, sus sistemas, el tejido neuronal y un plano celular. No es un atlas fotorealista ni un Blender en el browser. Es la matriz vacía —cámara, LOD, grafo de escena, telemetría— lista para inyectar `.glb` de verdad.

El nombre sigue a Borges: el Aleph es el punto que contiene todos los puntos. Aquí cada banda de distancia monta un mundo distinto en el origen, estilo *Powers of Ten*, no un universo newtoniano anidado con precisión métrica.

deprocast **no es Next.js**. El motor vive en Vite + React 19 + WebGL (`three@0.185`, `@react-three/fiber`, `@react-three/drei`). El Grafo 3D (Babel) y el Mapa (MapLibre) siguen en vistas aparte: no se mezclan canvas.

---

## 1. Qué hay en Fase 1

- Vista **Aleph** en la barra (mismo shell a pantalla completa que Grafo/Mapa).
- Zoom por rueda **exponencial** (`position.multiplyScalar(exp(delta))`), no el dolly lineal de `OrbitControls`. Órbita + pan con damping. Rango ~`1e-3` … `8e4`.
- **Siete bandas LOD**. Al cruzar un umbral se **desmonta** la capa anterior (libera GPU; no es `visible={false}`).
- Placeholders procedurales: esferas, cápsulas, tubos, instancias, nubes de puntos.
- HUD HTML (no `drei/Html`): sistemas anatómicos, modo sólido / rayos X / alambre, sliders BPM y EEG, salto de banda, inspector de nodo (color, visibilidad).
- Telemetría en un store. El corazón pulsa con BPM; el cerebro y las neuronas se mueven con las bandas EEG. Hoy los valores salen de sliders. No hay anillo ni EEG real.
- Grafo de escena `{ kind: 'procedural' | 'glb', url? }`. Si un nodo pasa a `glb` + `url`, el motor carga el asset con `useGLTF` sin reescribir las capas.

## 2. Qué no hay (a propósito)

- Modelos `.glb` de anatomía, topografía o planetas.
- MapLibre dentro de Three. El GIS táctico ya está en el módulo Mapa.
- Sensores. Soma / Noos siguen siendo agentes-bosquejo.
- Escultura de malla, física de fluidos, connectome real, efemérides de Mercurio.
- “Conocerlo todo”: Fase 1 es el motor, no el catálogo del universo.

---

## 3. Bandas LOD

La distancia es `camera.position.length()` respecto del origen. El HUD muestra `10^log10(d)` y la banda.

| Banda | Distancia | Contenido |
|-------|-----------|-----------|
| Cósmico | ≥ 8000 | Estrellas, Tierra y Mercurio chicos |
| Planeta | 800–8000 | Globos (Tierra con atmósfera/continentes placeholder, Mercurio) |
| Paisaje | 80–800 | Plano, ríos, caminos, bosque instanciado |
| Cuerpo | 8–80 | Figura humana (cápsulas) |
| Órgano | 0.8–8 | Corazón, cerebro, pulmones, hígado, glándulas… |
| Tejido | 0.08–0.8 | Neuronas (puntos) + vasos |
| Micro | < 0.08 | Células y bacterias |

La piel se vuelve translúcida en órgano/tejido para no tapar el interior. Los objetos cósmicos no usan sistemas anatómicos: siempre se ven en su banda salvo que el inspector los oculte.

El `near`/`far` de la cámara se reescribe cada frame en función de `d` para no romper el z-buffer en el zoom extremo.

---

## 4. Sistemas y telemetría

Sistemas (toggles): nervioso, cardiovascular, endocrino, respiratorio, digestivo, esquelético, linfático, integumentario.

Un nodo del grafo declara `systems[]`. Si el array está vacío, el nodo no depende de toggles (Tierra, ríos, células). Si no, se muestra cuando **alguno** de sus sistemas está activo.

Telemetría:

```
{ bpm, eeg: { delta, theta, alpha, beta, gamma } }
```

- Corazón: doble pico lub-dub por latido (`useFrame` lee el store, no re-render 60 fps).
- Cerebro: escala suave con α/β.
- Neuronas: desplazamiento de puntos ponderado por las cinco bandas (Hz centrales ~2.5 / 6 / 10 / 20 / 40).

Para enchufar un sensor mañana: escribir en `setBpm` / `setEegBand` (o `setAlephUi`) desde un WebSocket o `GET` periódico. El canvas ya consume el mismo store.

---

## 5. Cómo inyectar un `.glb`

En `src/aleph/sceneGraph.ts`, el nodo del corazón hoy es procedural. Fase 2:

```
{
  id: 'heart',
  label: 'Corazón',
  kind: 'glb',
  lod: ['body', 'organ', 'tissue'],
  systems: ['cardiovascular'],
  color: '#c45c4a',
  url: '/models/heart.glb',
}
```

Dejar el archivo en `public/models/` (Vite lo sirve en crudo). `GlbNode` clona la escena y reutiliza el clic → inspector. El pulso BPM de la geometría procedural **no** se aplica solo al glb: hay que envolver el `primitive` en el mismo `useFrame` de escala, o animar un morph del asset. Eso es trabajo de Fase 2 por órgano.

No scrapear Sketchfab a ciegas. Licencia primero, archivo después.

---

## 6. Archivos

| Pieza | Ruta |
|-------|------|
| Shell de vista | `src/components/aleph/AlephSection.tsx` |
| Canvas / luces / LOD mount | `src/aleph/UniverseEngine.tsx` |
| Zoom log + near/far | `src/aleph/LogZoomControls.tsx` |
| Lectura de banda | `src/aleph/useCameraLod.ts` |
| Store (UI + LOD) | `src/aleph/store.ts` |
| Grafo de escena | `src/aleph/sceneGraph.ts` |
| Sistemas / telemetría / LOD tables | `src/aleph/systems.ts`, `telemetry.ts`, `lod.ts` |
| Capas | `src/aleph/layers/{Cosmic,Landscape,Human,Micro}Layer.tsx` |
| HUD | `src/aleph/hud/AlephHud.tsx` |
| Loader glb | `src/aleph/GlbNode.tsx` |
| Estilos | `src/index.css` (bloque Aleph) |
| Módulo OS | `src/lib/deprocast/modules.ts` (`aleph`) |

El Canvas **solo existe** mientras la vista Aleph está activa. Babel 3D y Aleph no comparten WebGLContext. La sección se carga con `React.lazy` (`AlephSection-*.js`) para no inflar el bundle del resto del OS.

---

## 7. Fase 2 — modelos de alta fidelidad

La cámara y la telemetría ya funcionan con formas básicas. El siguiente corte es **contenido**, no más motor.

Fuentes con licencia usable (verificar cada dump; no son endorsements):

- Anatomía: [Z-Anatomy](https://www.z-anatomy.com/) (CC BY-SA, derivado de BodyParts3D), [BodyParts3D](https://lifesciencedb.jp/bp3d/) (CC BY-SA), OpenAnatomy / Anatomography. Exportar a glTF, no arrastrar el Blender crudo de 2 GB al repo.
- Planetas: texturas NASA / USGS SVS (dominio público en la mayoría de productos SVS). Tierra: Blue Marble / NASA Visible Earth. Mercurio: MESSENGER / USGS.
- Cielo: HIPPARCOS / Gaia no van a un `Points` de 5k estrellas; para Fase 2 basta un skybox o un catálogo recortado.
- Paisaje: **no** duplicar MapLibre. En banda paisaje se puede mostrar un CTA “abrir Mapa” o, más adelante, un plano con heightmap local. Ríos/bosques reales = datos GIS del módulo Mapa.
- Neuronas: un connectome completo no cabe en el browser. Instancing + un recorte (p. ej. columna cortical) o un `.glb` de tractografía simplificada.

Orden sugerido:

1. Un órgano piloto (corazón o cerebro) con pulso/EEG sobre el glb.
2. Textura de Tierra en el globo planetario.
3. Decidir si el paisaje salta al módulo Mapa o recibe un heightmap propio.
4. Cablear Soma a telemetría real (API del anillo / export CSV), sin fingir el hardware.

---

## 8. Relación con Vitalidad

El módulo Vitalidad sigue marcado ausente en el catálogo. Aleph es la **vista espacial** que Soma / Noos podrían habitar: pulso, ondas, sistemas. No reemplaza el tridente del Calendario ni el GIS del Mapa. Tres escalas distintas: tiempo (Calendario), territorio (Mapa), cuerpo/cosmos (Aleph).
