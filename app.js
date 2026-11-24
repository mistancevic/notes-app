'use strict';

(function () {
  var STORAGE_KEY = 'notes-app:notes';
  var AUTOSAVE_MS = 500;

  var notes = [];
  var currentId = null;
  var canSave = true;      // false if stored data is unreadable, so we never overwrite it
  var autosaveTimer = null;

  var el = {
    newBtn: document.getElementById('new-note'),
    banner: document.getElementById('banner'),
    list: document.getElementById('note-list'),
    emptyList: document.getElementById('empty-list'),
    search: document.getElementById('search'),
    noMatches: document.getElementById('no-matches'),
    placeholder: document.getElementById('placeholder'),
    editor: document.getElementById('editor'),
    title: document.getElementById('note-title'),
    body: document.getElementById('note-body'),
    status: document.getElementById('status'),
    deleteBtn: document.getElementById('delete-note')
  };

  // ---------- Storage ----------

  function showBanner(message) {
    el.banner.textContent = message;
    el.banner.hidden = false;
  }

  function isValidNote(n) {
    return n && typeof n === 'object' && typeof n.id === 'string' &&
      typeof n.title === 'string' && typeof n.body === 'string';
  }

  // A note with no title and no body is never saved or listed.
  function isEmptyNote(n) {
    return n.title.trim() === '' && n.body.trim() === '';
  }

  function hasContent(n) {
    return !isEmptyNote(n);
  }

  function loadNotes() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      canSave = false;
      showBanner('Your browser is blocking storage, so notes cannot be loaded or saved.');
      return [];
    }
    if (raw === null) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.filter(isValidNote).filter(hasContent);
    } catch (e) {
      canSave = false;
      showBanner('Saved notes could not be read. Saving is turned off so your existing data is not overwritten.');
      return [];
    }
  }

  function saveNotes() {
    if (!canSave) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.filter(hasContent)));
      return true;
    } catch (e) {
      showBanner('Could not save: browser storage is full or unavailable.');
      return false;
    }
  }

  // ---------- Helpers ----------

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function findNote(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) return notes[i];
    }
    return null;
  }

  // "Saved at 4:16 PM" today; older saves also show the date ("Saved Nov 20 at 4:16 PM").
  function savedText(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return 'Saved';
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return 'Saved at ' + time;
    var date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return 'Saved ' + date + ' at ' + time;
  }

  function showSavedStatus(note) {
    el.status.textContent = isEmptyNote(note) ? '' : savedText(note.updatedAt);
  }

  // ---------- Rendering ----------

  // True if the note's title or body contains the search text (ignoring case).
  function matchesSearch(note, query) {
    return note.title.toLowerCase().indexOf(query) !== -1 ||
      note.body.toLowerCase().indexOf(query) !== -1;
  }

  function renderList() {
    var visible = notes.filter(hasContent);
    var query = el.search.value.trim().toLowerCase();
    var matching = query === '' ? visible : visible.filter(function (note) {
      return matchesSearch(note, query);
    });
    var sorted = matching.sort(function (a, b) {
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    el.list.replaceChildren();
    sorted.forEach(function (note) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'note-item';
      btn.dataset.id = note.id;
      if (note.id === currentId) btn.setAttribute('aria-current', 'true');

      var title = document.createElement('span');
      title.className = 'note-item-title';
      title.textContent = note.title.trim() || 'Untitled';

      var preview = document.createElement('span');
      preview.className = 'note-item-preview';
      preview.textContent = note.body.trim().split('\n')[0] || 'No content';

      btn.append(title, preview);
      li.append(btn);
      el.list.append(li);
    });

    el.emptyList.hidden = visible.length > 0;
    el.noMatches.hidden = !(visible.length > 0 && matching.length === 0);
  }

  function renderEditor() {
    var note = findNote(currentId);
    if (!note) {
      currentId = null;
      el.editor.hidden = true;
      el.placeholder.hidden = false;
      return;
    }
    el.editor.hidden = false;
    el.placeholder.hidden = true;
    el.title.value = note.title;
    el.body.value = note.body;
    showSavedStatus(note);
  }

  // ---------- Actions ----------

  function commitEdits() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    var note = findNote(currentId);
    if (!note) return;
    // Nothing changed (e.g. typed then undid it): clear "Saving…" back to the saved time.
    if (note.title === el.title.value && note.body === el.body.value) {
      showSavedStatus(note);
      return;
    }

    note.title = el.title.value;
    note.body = el.body.value;
    note.updatedAt = new Date().toISOString();
    if (isEmptyNote(note)) {
      saveNotes(); // drops it from storage if it was saved before
      el.status.textContent = '';
    } else if (saveNotes()) {
      showSavedStatus(note);
    } else {
      el.status.textContent = 'Not saved';
    }
    renderList();
  }

  // Commit the open note, and throw it away if it is empty.
  function leaveCurrentNote() {
    commitEdits();
    var note = findNote(currentId);
    if (note && isEmptyNote(note)) {
      notes = notes.filter(function (n) { return n.id !== note.id; });
    }
  }

  function openNote(id) {
    leaveCurrentNote();
    currentId = id;
    renderList();
    renderEditor();
  }

  function newNote() {
    leaveCurrentNote();
    var now = new Date().toISOString();
    // Kept in memory only; it is saved once it has a title or body.
    var note = { id: makeId(), title: '', body: '', createdAt: now, updatedAt: now };
    notes.push(note);
    currentId = note.id;
    renderList();
    renderEditor();
    el.title.focus();
  }

  function deleteNote() {
    var note = findNote(currentId);
    if (!note) return;
    // An empty note was never saved, so there is nothing to confirm.
    if (isEmptyNote({ title: el.title.value, body: el.body.value })) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      notes = notes.filter(function (n) { return n.id !== currentId; });
      saveNotes();
      currentId = null;
      renderList();
      renderEditor();
      return;
    }
    var name = note.title.trim() || 'this untitled note';
    if (!window.confirm('Delete "' + name + '"? This cannot be undone.')) return;

    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    notes = notes.filter(function (n) { return n.id !== currentId; });
    saveNotes();
    currentId = null;
    renderList();
    renderEditor();
  }

  function scheduleAutosave() {
    el.status.textContent = 'Saving…';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(commitEdits, AUTOSAVE_MS);
  }

  // ---------- Events ----------

  el.newBtn.addEventListener('click', newNote);
  el.deleteBtn.addEventListener('click', deleteNote);

  el.list.addEventListener('click', function (e) {
    var btn = e.target.closest('.note-item');
    if (btn) openNote(btn.dataset.id);
  });

  el.editor.addEventListener('submit', function (e) {
    e.preventDefault();
    commitEdits();
  });

  el.search.addEventListener('input', renderList);

  // Esc clears the search box and shows all notes again.
  el.search.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    if (el.search.value === '') return;
    el.search.value = '';
    renderList();
  });

  el.title.addEventListener('input', scheduleAutosave);
  el.body.addEventListener('input', scheduleAutosave);

  // Enter in the title saves and moves to the body (Enter in the body still adds a line).
  el.title.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    commitEdits();
    el.body.focus();
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      commitEdits();
    }
  });

  // Save pending edits if the tab is hidden or closed.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') commitEdits();
  });
  window.addEventListener('pagehide', commitEdits);

  // Pick up changes made in another tab.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    var editing = autosaveTimer !== null;
    var current = findNote(currentId);
    notes = loadNotes();
    // Keep an unsaved empty note open rather than closing it under the user.
    if (current && isEmptyNote(current) && !findNote(current.id)) notes.push(current);
    renderList();
    if (!editing) renderEditor();
  });

  // ---------- Start ----------

  notes = loadNotes();
  renderList();
  renderEditor();
})();
