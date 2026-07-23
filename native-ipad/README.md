# Estudio Live para iPad

Este directorio es un prototipo nativo separado. No modifica la PWA publicada ni sus datos. Al compilar, `scripts/sync-web.mjs` crea en `www/` una copia desechable de la app web y añade el puente de Live Activities.

## Coste real

| Uso | Coste | Limitación |
| --- | ---: | --- |
| Código, Capacitor y Xcode | 0 | Xcode necesita un Mac |
| Prueba en tu propio iPad con Personal Team | 0 | El perfil caduca a los 7 días y hay que reinstalar |
| Instalación estable y distribución | 99 USD/año | Requiere Apple Developer Program |

Apple documenta los límites de la cuenta gratuita: 10 App IDs, 3 dispositivos y perfiles de 7 días. No se debe pagar nada para llegar hasta la prueba personal.

- Cuenta gratuita: https://developer.apple.com/support/compare-memberships/
- Programa de pago: https://developer.apple.com/programs/whats-included/
- ActivityKit: https://developer.apple.com/documentation/ActivityKit
- Interactividad: https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities

## Qué permite

- Mostrar un cronómetro o temporizador vivo mediante ActivityKit.
- `+5` en temporizador y `Terminar` en ambos modos.
- Aplicar esas acciones a la sesión web al volver a la app.
- Sustituir los avisos web por una única Live Activity en la variante nativa.

## Límite importante del iPad

La Live Activity aparece en ubicaciones controladas por iPadOS, especialmente pantalla bloqueada e inicio. No es una ventana libre que pueda permanecer permanentemente encima de una aplicación de partituras. La pestaña `Partitura abierta` de `preview.html` muestra esta diferencia de forma deliberada.

## Probar la interfaz sin Mac

Abre `preview.html` en un navegador. El selector permite comparar temporizador y cronómetro, usar `+5`, terminar y cambiar entre pantalla bloqueada y partitura abierta.

## Preparar la app en un Mac

Requisitos: Mac con Xcode actual, Node.js, iPad con iPadOS 17 o posterior y una cuenta Apple gratuita.

```bash
cd native-ipad
npm install
npm run ios:create
npm run ios:open
```

En Xcode:

1. Selecciona tu cuenta gratuita `Personal Team` para el target principal.
2. Establece iPadOS 17 como deployment target.
3. Añade un target `Widget Extension` y marca `Include Live Activity`.
4. Añade `StudyLiveActivityAttributes.swift`, `StudyPendingActions.swift` y `StudyLiveActivityIntents.swift` tanto al target principal como a la extensión.
5. Añade `StudyLiveActivityPlugin.swift` y `StudyBridgeViewController.swift` solo al target principal.
6. Sustituye el Swift generado de la extensión por `StudyLiveActivityWidget.swift`.
7. Añade `NSSupportsLiveActivities = YES` al `Info.plist` del target principal. El fragmento está en `App-Info.plist.fragment.xml`.
8. En `Main.storyboard`, cambia la clase del controlador de `CAPBridgeViewController` a `StudyBridgeViewController` y el módulo a `App`.
9. Firma también la extensión con tu `Personal Team` y ejecuta en el iPad físico.

Si Xcode rechaza la firma de la extensión con `Personal Team`, se detiene la prueba en ese punto. No se activa ninguna suscripción ni se genera ningún cargo.

## Actualizar la copia web

Cuando cambie la PWA principal:

```bash
cd native-ipad
npm run ios:sync
```

`www/`, `ios/` y `node_modules/` son artefactos locales ignorados por Git. La versión web original sigue siendo la fuente y continúa funcionando de manera independiente.

