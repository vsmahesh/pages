customElements.define(
  "ascvd-estimator",
  class extends HTMLElement {
    contextValues = {};
    constructor() {
      super();
      const template = document.getElementById(
        "ascvd-estimator-template"
      ).content;
      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(template.cloneNode(true));

      this.bindClickEvent();
    }

    bindClickEvent() {
      const eventName = "onclick";
      [
        ...this.shadowRoot.querySelectorAll(`[${eventName}]`),
        ...this.querySelectorAll(`[${eventName}]`),
      ].forEach((item) => {
        let functionName = item.getAttribute(eventName);

        item[eventName] = (event) => {
          if (typeof this[functionName] === "function") {
            this[functionName](event);
          } else {
            console.error(`${functionName} is not defined`);
          }
        };
      });
    }

    reEstimate = (e) => {
      this.contextValues.isSmoker =
        this.shadowRoot.querySelector("#smoker").checked;
      this.contextValues.onHypertensionTreatment =
        this.shadowRoot.querySelector("#onHPMed").checked;
      const ascvdRisk = this.calculateASCVD(
        this.contextValues.age,
        this.contextValues.gender,
        this.contextValues.totalCholesterol,
        this.contextValues.hdlCholesterol,
        this.contextValues.systolicBP,
        this.contextValues.onHypertensionTreatment,
        this.contextValues.hasDiabetes,
        this.contextValues.isSmoker
      );

      let className;
      if (ascvdRisk.risk < 5) {
        className = "low";
      } else if (ascvdRisk.risk < 7.5) {
        className = "borderline";
      } else if (ascvdRisk.risk < 20) {
        className = "intermediate";
      } else {
        className = "high";
      }

      this.shadowRoot.querySelector("#riskValue").innerHTML =
        ascvdRisk.risk.toFixed(1);

        this.shadowRoot.querySelector("svg").classList = [className];
    };

    get baseUrl() {
      return this.attributes["base-url"].value;
    }

    async connectedCallback() {
      const urls = [
        "/api/phr/v1/demographic",
        "/api/phr/v1/myhealth/hba1c-data-manager",
        "/api/phr/v1/myhealth/cholesterol-data-manager",
        "/api/phr/v1/myhealth/blood-pressure-data-manager",
      ];

      const requests = urls.map((url) => fetch(`${this.baseUrl}${url}`));

      const currentYear = new Date().getFullYear();
      Promise.all(requests)
        .then((responses) => Promise.all(responses.map((resp) => resp.json())))
        .then((data) => {
          console.log(data);

          const basicInformation = data[0].basicItem;
          const latestCholestrol = data[2][0].values;
          const latestBP = data[3][0].values;
          const latestA1C = data[1][0].values;

          this.contextValues.age = currentYear - basicInformation.birthYear;
          this.contextValues.gender =
            basicInformation.genderOfPerson.toLowerCase();
          this.contextValues.totalCholesterol = this.convertMmolToMgDl(
            latestCholestrol.find((ch) => ch.name == "totalcholesterol").data
              .value
          );
          this.contextValues.hdlCholesterol = this.convertMmolToMgDl(
            latestCholestrol.find((ch) => ch.name == "hdl").data.value
          );
          this.contextValues.hasDiabetes =
            latestA1C.find((v) => v.name == "hba1c").data.value > 5.6;
          this.contextValues.systolicBP = latestBP.find(
            (v) => v.name == "blood-pressure"
          ).data.systolic;
          this.contextValues.isSmoker = false;
          this.contextValues.onHypertensionTreatment = false;

          this.reEstimate(undefined);
        })
        .catch((error) => console.error("Request failed", error));
    }

    convertMmolToMgDl = (mmol) => mmol * 38.67;

    calculateASCVD = (
      age,
      sex,
      totalCholesterol,
      hdlCholesterol,
      systolicBP,
      onHypertensionTreatment,
      diabetes,
      smoker
    ) => {
      // Coefficients for no AA race
      const coefficients = {
        male: {
          mnxb: 61.1816,
          s010: 0.91436,
          genderAge: 0,
          systolicBPInTreatment: 1.797,
          ageSmoker: -1.795,
          systolicBPNotInTreatment: 1.764,
          smoker: 7.837,
          diabetes: 0.658,
          agetc: -2.664,
          ageHdl: 1.769,
          age: 12.344,
          totalCholesterol: 11.853,
          hdlCholesterol: -7.99,
        },
        female: {
          mnxb: -29.1817,
          s010: 0.96652,
          genderAge: 4.884,
          systolicBPInTreatment: 2.019,
          ageSmoker: -1.665,
          systolicBPNotInTreatment: 1.957,
          smoker: 7.574,
          diabetes: 0.661,
          agetc: -3.114,
          ageHdl: 3.149,
          age: -29.799,
          totalCholesterol: 13.54,
          hdlCholesterol: -13.578,
        },
      };

      const coefficient = coefficients[sex];

      const logarithms = {
        age: Math.log(age),
        real: {
          choT: Math.log(totalCholesterol),
          choHDL: Math.log(hdlCholesterol),
          sBP: Math.log(systolicBP),
        },
        optimal: {
          choT: Math.log(170),
          choHDL: Math.log(50),
          sBP: Math.log(110),
        },
      };

      return {
        risk:
          (1 -
            Math.pow(
              coefficient.s010,
              Math.exp(
                this.calculateScore(
                  { age: logarithms.age, ...logarithms.real },
                  coefficient,
                  onHypertensionTreatment,
                  smoker,
                  diabetes
                ) - coefficient.mnxb
              )
            )) *
          100,
        riskOptimal:
          (1 -
            Math.pow(
              coefficient.s010,
              Math.exp(
                this.calculateScore(
                  { age: logarithms.age, ...logarithms.optimal },
                  coefficient,
                  onHypertensionTreatment,
                  smoker,
                  diabetes
                ) - coefficient.mnxb
              )
            )) *
          100,
      };
    };

    calculateScore = (
      logarithms,
      coefficient,
      onHypertensionTreatment,
      smoker,
      diabetes
    ) =>
      coefficient.age * logarithms.age +
      coefficient.totalCholesterol * logarithms.choT +
      coefficient.agetc * logarithms.age * logarithms.choT +
      coefficient.hdlCholesterol * logarithms.choHDL +
      coefficient.ageHdl * logarithms.age * logarithms.choHDL +
      coefficient.systolicBPInTreatment *
        logarithms.sBP *
        Number(onHypertensionTreatment) +
      coefficient.systolicBPNotInTreatment *
        logarithms.sBP *
        Number(!onHypertensionTreatment) +
      coefficient.smoker * Number(smoker) +
      coefficient.ageSmoker * logarithms.age * Number(smoker) +
      coefficient.diabetes * Number(diabetes) +
      coefficient.genderAge * logarithms.age * logarithms.age;
  }
);
