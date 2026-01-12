import type { PrimeBusinessStatus } from "@/db/business";
import * as encoding from "@std/encoding";
import type { CResResponse } from ".";

type Props = { termUrl: string; cres: (success: boolean) => CResResponse };

export function ThreeDsForm({ termUrl, cres }: Props) {
  return (
    <>
      <h1>Hello, what do I do with the challenge?</h1>
      <form method="post" action={termUrl}>
        <button id="success" type="submit">
          Succeed 3ds challenge
        </button>
        <input
          type="hidden"
          name="cres"
          value={encoding.encodeBase64(JSON.stringify(cres(true)))}
        />
      </form>

      <form method="post" action={termUrl}>
        <button id="fail" type="submit">
          Fail 3ds challenge
        </button>
        <input
          type="hidden"
          name="cres"
          value={encoding.encodeBase64(JSON.stringify(cres(false)))}
        />
      </form>
    </>
  );
}

export function StatusPage(status: PrimeBusinessStatus) {
  let titleStatusMapping: Record<PrimeBusinessStatus, string> = {
    pending: "Transaction pending",
    approved: "Transaction approved",
    declined: "Transaction declined",
  };
  return (
    <html>
      <head>
        <title>{titleStatusMapping[status]}</title>
      </head>
      <body onload="javascript:OnLoadEvent();">
        <br />
        <br />
        <b>Processing...</b>
      </body>
    </html>
  );
}

// function OnLoadEvent() {
//   var host = "https://jpay.alataucitybank.kz/ecom/api";
//   window.location.href =
//     host +
//     "?CB=SR&RES=0&ORDER=17679943941345850595203494&RC=00&RDESC=Approved&AMOUNT=5000.00&CUR=KZT&MERCH=gamerush.kz&MERCH_URL=" +
//     encodeURIComponent(
//       "https://business.paygateway.kz/callback/jusan?redirect=true".replace(
//         new RegExp("&amp;", "g"),
//         "&",
//       ),
//     ) +
//     "&DESK=" +
//     encodeURIComponent("DXC28ZHGILVMN") +
//     "&REF=601015047818&INT_REF=FD7F2682E350768E&AC=822279&COMMISSION=&AC=822279&CT=&CTT=";
// }
// Pragma: no-cache Cache-Control: no-store Content-type: application/json;charset=UTF-8 { "type": "success", "cb": "SR", "res": "0", "order": "17679943941345850595203494", "RC": "00", "rdesc": "Approved", "amount": "5000.00", "cur": "KZT", "merch": "gamerush.kz", "merchUrl": "https://business.paygateway.kz/callback/jusan?redirect=true", "desk": "DXC28ZHGILVMN", "ref": "601015047818", "intRef": "FD7F2682E350768E", "ac": "822279", "commission": "", "ourCard": "N", "CT": "", "CTT": "", "ECI": "05", "3DS": "TDS", "DIAG_CODE": "NONE" }
