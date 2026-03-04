# Meow Syntax Reference

## File Format

A `.meow` file has two parts separated by `---`:

```
// Part 1: Prelude (state + helpers)
counter = 0
text = "hello"

function greet = () => { ... }

---

// Part 2: Template (HTML-like)
<div>
  <h1>{text}</h1>
</div>
```

## Prelude

### State

Declare reactive state with `name = value`:

```
counter = 0
text = "meow"
items = [1, 2, 3]
```

These become reactive: when you assign to them, the UI re-renders.

### Helpers

Helper functions can be defined in two styles:

**Arrow function:**

```
function printText = () => {
  console.log(counter + " MEOW!");
}
```

**Const/let:**

```
const double = (x) => x * 2
```

Helpers receive `(state, helpers, event)` when called from event handlers. Inside the function body, `counter` and `text` refer to `state.counter` and `state.text` automatically.

## Template Syntax

### Expressions `{expr}`

Embed JavaScript expressions in the template. Identifiers resolve to state, helpers, or components:

```html
<h1>{text}</h1>
<p>Count: {counter}</p>
<button onClick="{printText}">Print</button>
```

- `text`, `counter` → `state.text`, `state.counter`
- `printText` → `helpers.printText` (called when clicked)

### Event Handlers

Use `onEventName={expr}`. The expression runs when the event fires.

**Assignments (update state):**

```html
<button onClick="{counter" ="counter" + 1}>+</button> <button onClick="{counter" ="counter" - 1}>-</button>
```

**Helper calls (bare reference is auto-called):**

```html
<button onClick="{printText}">Print</button>
```

**Input binding:**

```html
<input value="{text}" onInput="{text" ="event.target.value}" placeholder="Type here" />
```

Use `event` to access the DOM event (e.g. `event.target.value`).

### Conditionals: `if` / `end` (Ruby-like)

Show content when a condition is true. No indentation required.

```
if count > 0
  <p>Count is positive</p>
end
```

Optional `do` is allowed: `if count > 0 do` ... `end`

### Loops: `each` / `end` (Ruby-like)

Repeat content for each item in an array. Keys are auto-generated.

```
each items as item
  <li>{item}</li>
end
```

The expression can be any array-like value:

```
each Array(counter).fill(0).map((_, idx) => idx) as i
  <li>Item {i}</li>
end
```

Optional `do` is allowed: `each items as item do` ... `end`. Inside the loop, the iterator variable (`item`, `i`) is in scope.

### Components

**Inline (template syntax):**

```
component Btn = <button class="btn" onClick={onClick}>{label}</button>
```

**Import from file:**

```
component Btn from "./components/btn.meow"
use Btn from "./components/btn.meow"
import Btn from "./components/btn.meow"
import { Btn, Card } from "./components/ui.meow"
import * as UI from "./components/ui.meow"
```

- `component X from` — load component from `.meow` file
- `use` / `import X from` — same, default component
- `import { A, B }` — named imports from multi-component files
- `import * as UI` — namespace import; use `<UI.Btn>` in the template

**Component file (block style):**

```
component Btn
  prop label = "Click"
  prop onClick = () => {}
  ---
  <button class="meow-btn" onClick={onClick}>{label}</button>

component Card
  prop title = "Untitled"
  ---
  <div class="meow-card">{title}</div>
```

Use them in the template (PascalCase tags):

```html
<Btn label="Click" onClick="{handleClick}" /> <UI.Btn label="From namespace" onClick="{handleClick}" />
```

Components receive `(props, children)`. `prop` defaults are merged with parent props.

### Attributes

- **Static:** `class="foo"` — literal value
- **Dynamic:** `attr={expr}` — expression evaluated at render
- **Both:** dynamic overrides static when the same attribute

```html
<input value={text} onInput={text = event.target.value} placeholder="Type here" />
<div class="container" class={isActive ? "active" : ""}>...</div>
```

## Comments

- Prelude: `//` line comments
- Template: `//` line comments (stripped before compile)
