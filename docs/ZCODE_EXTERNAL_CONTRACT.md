# Contrato externo de ZCode

ZCode en `~/zcode-agent` y `~/zcode-agent/prueba-agente` pertenece al teléfono del
usuario. Codex no accede a esas carpetas. El Coding Plan no se trata como runtime
general ni como credencial de ClipForge.

## Frontera existente

`AgentRuntimeService({ provider })` admite un objeto `AgentProvider` con
`decide(task, context)` e `isConfigured()`. El provider devuelve una decisión;
`AgentOrchestrator` valida autonomía, ejecuta solo `AgentToolRegistry` y persiste
resultados. `ZaiAgentProvider` es una implementación reemplazable. Ninguna ruta
HTTP ni componente necesita importar ZCode.

Una futura conexión externa debe transportar un envelope versionado:

```json
{
  "version": 1,
  "requestId": "uuid",
  "executionId": "uuid",
  "stepCount": 0,
  "task": { "objective": "Proponer ideas respaldadas por fuentes", "autonomyMode": "MANUAL" },
  "context": { "remainingSteps": 12, "results": [], "tools": [] }
}
```

`task` completo viene de `normalizeAgentTask`; `context.tools` se genera mediante
`listDefinitions()`, nunca desde una lista enviada por el agente externo.
Sanear ambos con `sanitizeAgentValue` antes de transportarlos. La respuesta debe
devolver `version`, `requestId`, `executionId`, `stepCount` y una `decision`:

```json
{
  "type": "TOOL",
  "tool": "trends.query",
  "input": {},
  "rationale": "Consultar oportunidades antes de investigar",
  "output": {},
  "reason": null
}
```

Otras decisiones: `COMPLETE`, `WAITING_INFORMATION`, `WAITING_APPROVAL`. Una
decisión no contiene shell, tokens ni llamadas directas a redes sociales. El
adaptador futuro deberá correlacionar request/ejecución/paso, rechazar respuestas
obsoletas o duplicadas, limitar tamaño/tiempo y autenticar el transporte. Solo el
orquestador ejecutará herramientas. No existe todavía una API pública de polling
o recepción de decisiones: no usar rutas inventadas `/api/agent/*`.

## Prueba local de contrato, sin ejecutar herramientas

En una copia del repositorio en la máquina que tenga Node instalado, guardar la
decisión anterior en `decision.json` y ejecutar desde la raíz de ClipForge:

```bash
CLIPFORGE_AGENT_REAL_PUBLISHING=false node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { normalizeAgentDecision, sanitizeAgentValue } from './services/agent/AgentContracts.mjs';
import { AgentToolRegistry } from './services/agent/AgentToolRegistry.mjs';
const decision = normalizeAgentDecision(JSON.parse(await readFile('decision.json', 'utf8')));
const allowed = new AgentToolRegistry().listDefinitions();
if (decision.type === 'TOOL' && !allowed.some(tool => tool.name === decision.tool)) {
  throw new Error('Tool not allowed');
}
console.log(JSON.stringify(sanitizeAgentValue(decision), null, 2));
NODE
```

Esto valida sintaxis y allowlist; cada servicio conserva la validación semántica
de sus inputs. No ejecuta la decisión ni afirma que el transporte remoto exista.
Las pruebas del provider y el orquestador se ejecutan con:

```bash
CLIPFORGE_AGENT_REAL_PUBLISHING=false node --test tests/agent-foundation.test.mjs tests/autonomy-modes.test.mjs
```

Para usar el provider Z.ai actual se necesitan `CLIPFORGE_ZAI_API_KEY` y
`CLIPFORGE_ZAI_MODEL`, con endpoint general configurable mediante
`CLIPFORGE_ZAI_BASE_URL`. Mantener `CLIPFORGE_AGENT_REAL_PUBLISHING=false` y empezar
en MANUAL. No copiar la sesión CLI de Termux al servidor.
