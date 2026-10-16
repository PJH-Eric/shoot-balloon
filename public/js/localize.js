/* Browser-only names for shared rule data. Protocol IDs and player input stay unchanged. */
(function (w) {
  'use strict';
  var I = w.I18N, R = w.Rules, A = w.AI;
  function field(object, prop, key) {
    if (!object) return;
    Object.defineProperty(object, prop, { configurable: true, enumerable: true, get: function () { return I.t(key); } });
  }
  Object.keys(R.TYPES || R.MOLES || {}).forEach(function (id) {
    var object = (R.TYPES || R.MOLES)[id];
    field(object, 'label', "type." + id + '.label');
    field(object, 'hint', "type." + id + '.hint');
  });
  (R.MOLE_ORDER || R.TYPE_ORDER || []).forEach(function (id) {
    var object = R.typeOf(id);
    field(object, 'label', "type." + id + '.label');
    field(object, 'hint', "type." + id + '.hint');
  });
  (R.PACE_ORDER || []).forEach(function (id) {
    field(R.paceOf(id), 'label', 'pace.' + id + '.label');
    field(R.paceOf(id), 'blurb', 'pace.' + id + '.blurb');
    field(A.levelOf(id), 'label', 'pace.' + id + '.label');
    field(A.levelOf(id), 'blurb', 'ai.' + id + '.blurb');
  });
  (R.BOARDS || []).forEach(function (b) { field(b, 'note', 'board.' + b.key + '.note'); });
})(window);
