import { citySuggestions } from '../shared/cities';

export function setupCityPicker(
  root: HTMLElement,
  load: Promise<string[]>,
  t: (key: string) => string,
) {
  const input = root.querySelector<HTMLInputElement>('input[name=city]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-city-toggle]')!;
  const list = root.querySelector<HTMLElement>('[role=listbox]')!;
  let names: string[] = [],
    choices: string[] = [],
    active = -1,
    opened = false,
    loading = true;
  const close = () => {
    opened = false;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const highlight = (index: number) => {
    active = index;
    [...list.querySelectorAll<HTMLElement>('[role=option]')].forEach((node, i) =>
      node.setAttribute('aria-selected', String(i === index)),
    );
    const item = list.querySelectorAll<HTMLElement>('[role=option]')[index];
    if (item) {
      input.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  };
  const choose = (name: string) => {
    input.value = name;
    input.focus({ preventScroll: true });
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  const show = (all = false) => {
    opened = true;
    list.hidden = false;
    active = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-expanded', 'true');
    choices = citySuggestions(names, all ? '' : input.value);
    list.replaceChildren();
    choices.forEach((name, index) => {
      const option = document.createElement('li');
      option.id = list.id + '-' + index;
      option.role = 'option';
      option.tabIndex = -1;
      option.setAttribute('aria-selected', 'false');
      option.textContent = name;
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(name));
      list.append(option);
    });
    if (!choices.length) {
      const empty = document.createElement('li');
      empty.role = 'presentation';
      empty.className = 'muted';
      empty.textContent = t(loading ? 'جارٍ تحميل المدن…' : 'يمكنك كتابة مدينتك مباشرة.');
      list.append(empty);
    }
  };
  input.addEventListener('focus', () => show());
  input.addEventListener('input', () => show());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!opened) show();
      if (!choices.length) return;
      highlight(
        event.key === 'ArrowDown'
          ? (active + 1) % choices.length
          : active <= 0
            ? choices.length - 1
            : active - 1,
      );
    } else if (event.key === 'Enter' && opened && active >= 0) {
      event.preventDefault();
      choose(choices[active]);
    }
  });
  toggle.addEventListener('click', () => {
    if (opened) close();
    else show(true);
  });
  root.addEventListener('focusout', () =>
    setTimeout(() => {
      if (!root.contains(document.activeElement)) close();
    }, 0),
  );
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  void load
    .then((values) => {
      names = values.filter((value) => typeof value === 'string');
      loading = false;
      if (opened) show();
    })
    .catch(() => {
      loading = false;
      if (opened) show();
    });
}
