function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LIDE')
    .addItem('Crear hoja Tasks', 'setup')
    .addToUi();
}