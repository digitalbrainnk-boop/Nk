import com.android.apksig.ApkVerifier;

import java.io.File;

/**
 * Vérifie les signatures d'un APK avec apksig (la bibliothèque de vérification d'Android) :
 * schéma v1 (JAR, posé par jarsigner) et schéma v2 (posé par construire.py).
 * Usage : java -cp apksig.jar Verifier.java application.apk
 */
public class Verifier {
    public static void main(String[] args) throws Exception {
        ApkVerifier.Result resultat = new ApkVerifier.Builder(new File(args[0])).build().verify();
        for (ApkVerifier.IssueWithParams erreur : resultat.getErrors()) {
            System.err.println("ERREUR : " + erreur);
        }
        for (ApkVerifier.Result.V2SchemeSignerInfo signataire : resultat.getV2SchemeSigners()) {
            for (ApkVerifier.IssueWithParams erreur : signataire.getErrors()) {
                System.err.println("ERREUR v2 : " + erreur);
            }
        }
        if (!resultat.isVerified() || !resultat.isVerifiedUsingV1Scheme() || !resultat.isVerifiedUsingV2Scheme()) {
            System.err.println("v1 : " + resultat.isVerifiedUsingV1Scheme() + ", v2 : " + resultat.isVerifiedUsingV2Scheme());
            System.exit(1);
        }
        System.out.println("Signatures vérifiées par apksig (v1 + v2) : "
                + resultat.getSignerCertificates().get(0).getSubjectX500Principal());
    }
}
