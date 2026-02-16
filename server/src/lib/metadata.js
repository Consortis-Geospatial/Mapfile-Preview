function ensureWebMetadata(mapText, onlineresource) {
    // naive but practical: ensure WEB/METADATA block with WMS/WFS enables
    if (!/WEB\s*[\r\n]+/i.test(mapText)) {
      mapText = mapText.replace(/MAP/i, `MAP\n  WEB\n    METADATA\n      "wms_enable_request" "*"\n      "wfs_enable_request" "*"\n      "wms_onlineresource" "${onlineresource}"\n      "wfs_onlineresource" "${onlineresource}"\n    END\n  END\n`);
    } else if (!/WEB[\s\S]*METADATA[\s\S]*END[\s\S]*END/i.test(mapText)) {
      mapText = mapText.replace(/WEB/i, `WEB\n  METADATA\n    "wms_enable_request" "*"\n    "wfs_enable_request" "*"\n    "wms_onlineresource" "${onlineresource}"\n    "wfs_onlineresource" "${onlineresource}"\n  END\n`);
    }
    return mapText;
  }
  
  function ensureLayerMetadata(mapText) {
    // For each LAYER without WMS/WFS titles, add minimal metadata block
    return mapText.replace(/LAYER([\s\S]*?)END/gim, (whole, body) => {
      if (/METADATA/i.test(body)) return whole; // already present
      const injected = `LAYER${body}\n  METADATA\n    "wms_title" "[name]"\n    "wfs_title" "[name]"\n    "gml_include_items" "all"\n  END\nEND`;
      return injected;
    });
  }
  
  module.exports = { ensureWebMetadata, ensureLayerMetadata };
  