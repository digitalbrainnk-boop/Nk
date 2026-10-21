// Tests unitaires de la logique pure (pas de dépendance Firebase).
// Lancer : flutter test
import 'package:flutter_test/flutter_test.dart';

import 'package:db_localisation/modeles/position.dart';
import 'package:db_localisation/modeles/utilisateur.dart';
import 'package:db_localisation/services/service_auth.dart';

void main() {
  group('identifiantVersEmail', () {
    test('un e-mail est mis en minuscules et nettoyé', () {
      final r = ServiceAuth.identifiantVersEmail(
          '  Jean.Dupont@Example.COM ', TypeIdentifiant.email);
      expect(r, 'jean.dupont@example.com');
    });

    test('un téléphone devient un e-mail technique stable', () {
      // Différentes mises en forme du même numéro -> même identifiant.
      const attendu = '33612345678@phone.dblocalisation';
      expect(
        ServiceAuth.identifiantVersEmail('+33 6 12 34 56 78', TypeIdentifiant.telephone),
        attendu,
      );
      expect(
        ServiceAuth.identifiantVersEmail('0033-612-345-678', TypeIdentifiant.telephone),
        attendu,
      );
    });
  });

  group('Position', () {
    test('le lien Google Maps pointe sur lat,lng', () {
      const p = Position(lat: 48.8566, lng: 2.3522, source: 'gps');
      expect(p.lienGoogleMaps, 'https://maps.google.com/?q=48.8566,2.3522');
    });
  });

  group('TypeIdentifiant', () {
    test('conversion Firestore aller-retour', () {
      expect(TypeIdentifiant.email.valeurFirestore, 'email');
      expect(TypeIdentifiant.telephone.valeurFirestore, 'phone');
      expect(TypeIdentifiantX.depuisFirestore('phone'), TypeIdentifiant.telephone);
      expect(TypeIdentifiantX.depuisFirestore(null), TypeIdentifiant.email);
    });
  });
}
