//+------------------------------------------------------------------+
//| Dashboard.mqh - tableau de bord sur le graphique                 |
//| Objets graphiques uniquement ; aucune logique de trading ici :   |
//| l'EA lit les clics (OnChartEvent) et exécute les actions.        |
//+------------------------------------------------------------------+
#ifndef GLS_DASHBOARD_MQH
#define GLS_DASHBOARD_MQH

#include "Utils.mqh"

#define GLS_DASH_ROWS       30
#define GLS_DASH_CHECKS     18
#define GLS_BTN_CHECK       "btn_check"
#define GLS_BTN_START       "btn_start"
#define GLS_BTN_STOP        "btn_stop"
#define GLS_BTN_CLOSE       "btn_close"
#define GLS_BTN_HIDE        "btn_hide"

#define GLS_STATUS_INFO     0
#define GLS_STATUS_OK       1
#define GLS_STATUS_WARN     2
#define GLS_STATUS_FAIL     3

color RgbColor(const int r, const int g, const int b)
  {
   return (color)(r + (g << 8) + (b << 16));
  }

color StatusColor(const int status)
  {
   switch(status)
     {
      case GLS_STATUS_OK:   return RgbColor(80, 200, 120);
      case GLS_STATUS_WARN: return RgbColor(240, 170, 60);
      case GLS_STATUS_FAIL: return RgbColor(235, 80, 80);
     }
   return RgbColor(215, 215, 215);
  }

string FitText(const string text, const int maxLen)
  {
   if(StringLen(text) <= maxLen)
      return text;
   return StringSubstr(text, 0, maxLen - 1) + "~";
  }

class CGlsDashboard
  {
private:
   bool              m_created;
   int               m_x;
   int               m_y;
   int               m_w;
   int               m_lineH;
   int               m_font;
   int               m_panelH;
   int               m_checkCount;

   string            Name(const string id) const { return GLS_OBJ_PREFIX + id; }

   void              Rect(const string id, const int x, const int y, const int w, const int h, const color bg, const color border)
     {
      string n = Name(id);
      if(ObjectFind(0, n) < 0)
         ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
      ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
      ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_COLOR, border);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_ZORDER, 0);
     }

   void              Label(const string id, const int x, const int y, const string text, const color clr, const int size)
     {
      string n = Name(id);
      if(ObjectFind(0, n) < 0)
         ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
      ObjectSetString(0, n, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
      ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
      ObjectSetString(0, n, OBJPROP_TEXT, FitText(text, 63));
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_ZORDER, 1);
     }

   void              Button(const string id, const int x, const int y, const int w, const int h, const string text, const color bg)
     {
      string n = Name(id);
      if(ObjectFind(0, n) < 0)
         ObjectCreate(0, n, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
      ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
      ObjectSetString(0, n, OBJPROP_TEXT, text);
      ObjectSetString(0, n, OBJPROP_FONT, "Arial");
      ObjectSetInteger(0, n, OBJPROP_FONTSIZE, m_font);
      ObjectSetInteger(0, n, OBJPROP_COLOR, clrWhite);
      ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
      ObjectSetInteger(0, n, OBJPROP_BORDER_COLOR, RgbColor(90, 90, 90));
      ObjectSetInteger(0, n, OBJPROP_STATE, false);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_ZORDER, 2);
     }

public:
                     CGlsDashboard(void) : m_created(false), m_x(10), m_y(20), m_w(460), m_lineH(15), m_font(8), m_panelH(0), m_checkCount(0) {}

   bool              Created(void) const { return m_created; }

   void              Create(const int x, const int y, const int fontSize)
     {
      m_x = x;
      m_y = y;
      m_font = MathMax(6, MathMin(fontSize, 12));
      m_lineH = m_font * 2 - 1;
      m_w = 58 * (m_font - 1) + 40;
      int rowsH = GLS_DASH_ROWS * m_lineH + 10;
      int btnH = m_lineH + 8;
      m_panelH = rowsH + 2 * (btnH + 4) + 10;
      Rect("bg", m_x, m_y, m_w, m_panelH, RgbColor(24, 26, 32), RgbColor(200, 160, 60));
      for(int i = 0; i < GLS_DASH_ROWS; i++)
         Label("r" + IntegerToString(i), m_x + 8, m_y + 6 + i * m_lineH, " ", StatusColor(GLS_STATUS_INFO), m_font);
      int by = m_y + rowsH;
      int bw = (m_w - 24) / 2;
      Button(GLS_BTN_CHECK, m_x + 8, by, bw, btnH, "Vérifier la connexion", RgbColor(45, 85, 140));
      Button(GLS_BTN_START, m_x + 16 + bw, by, bw, btnH, "Démarrer le robot", RgbColor(40, 120, 70));
      Button(GLS_BTN_STOP, m_x + 8, by + btnH + 4, bw, btnH, "Arrêter le robot", RgbColor(150, 110, 30));
      Button(GLS_BTN_CLOSE, m_x + 16 + bw, by + btnH + 4, bw, btnH, "Fermer toutes les positions", RgbColor(150, 45, 45));
      m_created = true;
      ChartRedraw(0);
     }

   void              Destroy(void)
     {
      ObjectsDeleteAll(0, GLS_OBJ_PREFIX);
      m_created = false;
      m_checkCount = 0;
      ChartRedraw(0);
     }

   void              SetRow(const int i, const string text, const int status)
     {
      if(!m_created || i < 0 || i >= GLS_DASH_ROWS)
         return;
      string n = Name("r" + IntegerToString(i));
      ObjectSetString(0, n, OBJPROP_TEXT, FitText(text, 63));
      ObjectSetInteger(0, n, OBJPROP_COLOR, StatusColor(status));
     }

   void              SetTitleRow(const int i, const string text)
     {
      if(!m_created)
         return;
      string n = Name("r" + IntegerToString(i));
      ObjectSetString(0, n, OBJPROP_TEXT, FitText(text, 63));
      ObjectSetInteger(0, n, OBJPROP_COLOR, RgbColor(230, 190, 80));
     }

   //--- Panneau des résultats de vérification (sous le tableau de bord)
   void              ShowChecks(const string &lines[], const int &statuses[], const int count)
     {
      if(!m_created)
         return;
      HideChecks();
      int n = MathMin(count, GLS_DASH_CHECKS);
      int top = m_y + m_panelH + 6;
      int btnH = m_lineH + 8;
      Rect("chk_bg", m_x, top, m_w, (n + 1) * m_lineH + btnH + 16, RgbColor(18, 20, 26), RgbColor(80, 120, 180));
      Label("chk_title", m_x + 8, top + 5, "Résultat de la vérification (" + TimeToString(TimeLocal(), TIME_MINUTES | TIME_SECONDS) + ")", RgbColor(160, 190, 240), m_font);
      for(int i = 0; i < n; i++)
         Label("chk" + IntegerToString(i), m_x + 8, top + 5 + (i + 1) * m_lineH, lines[i], StatusColor(statuses[i]), m_font);
      Button(GLS_BTN_HIDE, m_x + m_w - 98, top + 8 + (n + 1) * m_lineH, 90, btnH, "Masquer", RgbColor(70, 70, 80));
      m_checkCount = n;
      ChartRedraw(0);
     }

   void              HideChecks(void)
     {
      ObjectDelete(0, Name("chk_bg"));
      ObjectDelete(0, Name("chk_title"));
      ObjectDelete(0, Name(GLS_BTN_HIDE));
      for(int i = 0; i < GLS_DASH_CHECKS; i++)
         ObjectDelete(0, Name("chk" + IntegerToString(i)));
      m_checkCount = 0;
      ChartRedraw(0);
     }

   //--- Identifie le bouton cliqué ("" si l'objet n'est pas un bouton du tableau)
   string            ButtonId(const string objectName) const
     {
      string ids[5];
      ids[0] = GLS_BTN_CHECK;
      ids[1] = GLS_BTN_START;
      ids[2] = GLS_BTN_STOP;
      ids[3] = GLS_BTN_CLOSE;
      ids[4] = GLS_BTN_HIDE;
      for(int i = 0; i < 5; i++)
         if(objectName == Name(ids[i]))
            return ids[i];
      return "";
     }

   //--- Remet le bouton à l'état relâché et affiche un retour visuel
   void              ReleaseButton(const string id, const string feedback)
     {
      string n = Name(id);
      if(ObjectFind(0, n) < 0)
         return;
      ObjectSetInteger(0, n, OBJPROP_STATE, false);
      if(StringLen(feedback) > 0)
         ObjectSetString(0, n, OBJPROP_TOOLTIP, feedback);
      ChartRedraw(0);
     }

   void              SetButtonText(const string id, const string text)
     {
      string n = Name(id);
      if(ObjectFind(0, n) >= 0)
         ObjectSetString(0, n, OBJPROP_TEXT, text);
     }

   void              Redraw(void)
     {
      if(m_created)
         ChartRedraw(0);
     }
  };

CGlsDashboard g_dash;

#endif // GLS_DASHBOARD_MQH
//+------------------------------------------------------------------+
