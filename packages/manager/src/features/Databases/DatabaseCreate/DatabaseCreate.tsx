import {
  CreateDatabasePayload,
  DatabaseType,
  DatabaseVersion,
  Engine,
  FailoverCount,
  ReplicationType,
} from '@linode/api-v4/lib/databases/types';
import { createDatabaseSchema } from '@linode/validation/lib/databases.schema';
import { useFormik } from 'formik';
import { groupBy } from 'ramda';
import * as React from 'react';
import { useHistory } from 'react-router-dom';
import MySQLIcon from 'src/assets/icons/mysql.svg';
import { makeStyles, Theme } from 'src/components/core/styles';
import Divider from 'src/components/core/Divider';
import FormControl from 'src/components/core/FormControl';
import FormControlLabel from 'src/components/core/FormControlLabel';
import FormHelperText from 'src/components/core/FormHelperText';
import Paper from 'src/components/core/Paper';
import RadioGroup from 'src/components/core/RadioGroup';
import Typography from 'src/components/core/Typography';
import BreadCrumb from 'src/components/Breadcrumb';
import Button from 'src/components/Button';
import CircleProgress from 'src/components/CircleProgress';
import Select, { Item } from 'src/components/EnhancedSelect/Select';
import SingleValue from 'src/components/EnhancedSelect/components/SingleValue';
import RegionSelect from 'src/components/EnhancedSelect/variants/RegionSelect';
import RegionOption from 'src/components/EnhancedSelect/variants/RegionSelect/RegionOption';
import ErrorState from 'src/components/ErrorState';
import Grid from 'src/components/Grid';
import MultipleIPInput from 'src/components/MultipleIPInput';
import Notice from 'src/components/Notice';
import Radio from 'src/components/Radio';
import TextField from 'src/components/TextField';
import SelectPlanPanel from 'src/features/linodes/LinodesCreate/SelectPlanPanel';
import { typeLabelDetails } from 'src/features/linodes/presentation';
import {
  useDatabaseVersionsQuery,
  useDatabaseTypesQuery,
  useCreateDatabaseMutation,
} from 'src/queries/databases';
import { useRegionsQuery } from 'src/queries/regions';
import { formatStorageUnits } from 'src/utilities/formatStorageUnits';
import getSelectedOptionFromGroupedOptions from 'src/utilities/getSelectedOptionFromGroupedOptions';
import { handleAPIErrors } from 'src/utilities/formikErrorUtils';
import { validateIPs } from 'src/utilities/ipUtils';
import scrollErrorIntoView from 'src/utilities/scrollErrorIntoView';

const useStyles = makeStyles((theme: Theme) => ({
  formControlLabel: {
    marginBottom: theme.spacing(),
  },
  btnCtn: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: theme.spacing(2),
  },
  selectPlanPanel: {
    padding: 0,
    margin: 0,
  },
}));

const engineIcons = {
  mysql: () => <MySQLIcon width="24" height="24" />,
};

const getEngineOptions = (versions: DatabaseVersion[]) => {
  const groupedVersions = groupBy<DatabaseVersion>((version) => {
    if (version.engine.match(/mysql/i)) {
      return 'MySQL';
    }
    if (version.engine.match(/postgresql/i)) {
      return 'PostgreSQL';
    }
    if (version.engine.match(/mongodb/i)) {
      return 'MongoDB';
    }
    if (version.engine.match(/redis/i)) {
      return 'Redis';
    }
    return 'Other';
  }, versions);
  return ['MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Other'].reduce(
    (accum, thisGroup) => {
      if (
        !groupedVersions[thisGroup] ||
        groupedVersions[thisGroup].length === 0
      ) {
        return accum;
      }
      return [
        ...accum,
        {
          label: thisGroup,
          options: groupedVersions[thisGroup].map((version) => ({
            ...version,
            value: `${version.engine}/${version.version}`,
            flag: engineIcons[version.engine],
          })),
        },
      ];
    },
    []
  );
};

export interface ExtendedDatabaseType extends DatabaseType {
  heading: string;
  subHeadings: [string, string];
}

interface NodePricing {
  hourly: string;
  monthly: string;
}

const DatabaseCreate: React.FC<{}> = () => {
  const classes = useStyles();
  const history = useHistory();

  const {
    data: regionsData,
    isLoading: regionsLoading,
    error: regionsError,
  } = useRegionsQuery();

  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = useDatabaseVersionsQuery();

  const {
    data: dbtypes,
    isLoading: typesLoading,
    error: typesError,
  } = useDatabaseTypesQuery();

  const { mutateAsync: createDatabase } = useCreateDatabaseMutation();

  const [type, setType] = React.useState<DatabaseType>();
  const [createError, setCreateError] = React.useState<string>();
  const [multiNodePricing, setMultiNodePricing] = React.useState<NodePricing>({
    hourly: '0',
    monthly: '0',
  });

  const engineOptions = React.useMemo(() => {
    if (!versions) {
      return [];
    }
    return getEngineOptions(versions);
  }, [versions]);

  const displayTypes: ExtendedDatabaseType[] = React.useMemo(() => {
    if (!dbtypes) {
      return [];
    }
    return dbtypes.map((type) => {
      const {
        label,
        memory,
        vcpus,
        disk,
        price: { monthly, hourly },
      } = type;
      const formattedLabel = formatStorageUnits(label);
      return {
        ...type,
        label: formattedLabel,
        heading: formattedLabel,
        subHeadings: [
          `$${monthly}/mo ($${hourly}/hr)`,
          typeLabelDetails(memory, disk, vcpus),
        ] as [string, string],
      };
    });
  }, [dbtypes]);

  const handleIPValidation = () => {
    const validatedIps = validateIPs(values.allow_list, {
      errorMessage: 'Must be a valid IPv4 address',
    });

    if (validatedIps.some((ip) => ip.error)) {
      setFieldValue('allow_list', validatedIps);
    } else {
      setFieldValue(
        'allow_list',
        validatedIps.map((ip) => {
          delete ip.error;
          return {
            ...ip,
          };
        })
      );
    }
  };

  const submitForm = async () => {
    if (values.allow_list.some((ip) => ip.error)) {
      return;
    }

    setCreateError(undefined);
    setSubmitting(true);
    const createPayload: CreateDatabasePayload = {
      ...values,
      allow_list: values.allow_list.map((ip) => ip.address),
    };

    try {
      const response = await createDatabase(createPayload);
      history.push(`/databases/${response.id}`);
    } catch (error) {
      handleAPIErrors(error, setFieldError, setCreateError);
    }

    setSubmitting(false);
  };

  const {
    values,
    errors,
    isSubmitting,
    handleSubmit,
    setFieldValue,
    setFieldError,
    setSubmitting,
  } = useFormik({
    initialValues: {
      label: '',
      engine: '' as Engine,
      region: '',
      type: '',
      failover_count: -1 as FailoverCount,
      replication_type: 'none' as ReplicationType,
      allow_list: [
        {
          address: '',
          error: '',
        },
      ],
    },
    validationSchema: createDatabaseSchema,
    validateOnChange: false,
    validate: handleIPValidation,
    onSubmit: submitForm,
  });

  React.useEffect(() => {
    if (errors) {
      scrollErrorIntoView();
    }
  }, [errors]);

  const disableCreateButton =
    !values.label ||
    !values.engine ||
    !values.region ||
    !values.type ||
    values.failover_count < 0 ||
    values.allow_list.some((item) => item.address === '');

  const nodeOptions = [
    {
      value: 0,
      label: (
        <Typography>
          1 Node
          <br />
          {`$${type?.price.monthly || 0}/month $${type?.price.hourly || 0}/hr`}
        </Typography>
      ),
    },
    {
      value: 2,
      label: (
        <Typography>
          3 Nodes - High Availability (recommended)
          <br />
          {`$${multiNodePricing.monthly || 0}/month $${
            multiNodePricing.hourly || 0
          }/hr`}
        </Typography>
      ),
    },
  ];

  React.useEffect(() => {
    if (values.type.length === 0 || !dbtypes) {
      return;
    }

    const type = dbtypes.find((type) => type.id === values.type);
    if (!type) {
      return;
    }

    setType(type);
    setMultiNodePricing({
      hourly: Number(
        type.price.hourly + type.addons.failover.price.hourly
      ).toFixed(2),
      monthly: Number(
        type.price.monthly + type.addons.failover.price.monthly
      ).toFixed(2),
    });
    setFieldValue('failover_count', type.memory === 1024 ? 0 : 2);
    setFieldValue(
      'replication_type',
      values.failover_count === 0 ? 'none' : 'semi-synch'
    );
  }, [dbtypes, setFieldValue, values.failover_count, values.type]);

  if (regionsLoading || !regionsData || versionsLoading || typesLoading) {
    return <CircleProgress />;
  }

  if (regionsError || versionsError || typesError) {
    return <ErrorState errorText="An unexpected error occurred." />;
  }

  return (
    <form onSubmit={handleSubmit}>
      <BreadCrumb
        labelTitle="Create"
        pathname={location.pathname}
        crumbOverrides={[
          {
            position: 1,
            label: 'Database Clusters',
          },
        ]}
      />
      <Paper>
        {createError ? <Notice error text={createError} /> : null}
        <Grid item>
          <Typography variant="h2">Name Your Cluster</Typography>
          <TextField
            data-qa-label-input
            errorText={errors.label}
            label="Cluster Label"
            onChange={(e) => setFieldValue('label', e.target.value)}
            value={values.label}
          />
        </Grid>
        <Divider spacingTop={38} spacingBottom={12} />
        <Grid item>
          <Typography variant="h2">Select Engine and Region</Typography>
          <Select
            label="Database Engine"
            value={getSelectedOptionFromGroupedOptions(
              values.engine,
              engineOptions
            )}
            errorText={errors.engine}
            options={engineOptions}
            components={{ Option: RegionOption, SingleValue }}
            placeholder={'Select a Database Engine'}
            onChange={(selected: Item<string>) => {
              setFieldValue('engine', selected.value);
            }}
            isClearable={false}
          />
        </Grid>
        <Grid item>
          <RegionSelect
            errorText={errors.region}
            handleSelection={(selected: string) =>
              setFieldValue('region', selected)
            }
            regions={regionsData}
            selectedID={values.region}
          />
        </Grid>
        <Divider spacingTop={38} spacingBottom={12} />
        <Grid item>
          <SelectPlanPanel
            data-qa-select-plan
            error={errors.type}
            types={displayTypes}
            onSelect={(selected: string) => {
              setFieldValue('type', selected);
            }}
            selectedID={values.type}
            updateFor={[values.type, errors]}
            header="Choose a Plan"
            className={classes.selectPlanPanel}
            isCreate
          />
        </Grid>
        <Divider spacingTop={26} spacingBottom={12} />
        <Grid item>
          <Typography variant="h2">Set Number of Nodes</Typography>
          <Typography>
            We recommend 3 nodes in a database cluster to avoid downtime during
            upgrades and maintenance.
          </Typography>
          <FormControl
            error={Boolean(errors.failover_count)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setFieldValue('failover_count', +e.target.value);
              setFieldValue(
                'replication_type',
                +e.target.value === 0 ? 'none' : 'semi-synch'
              );
            }}
            data-testid="database-nodes"
          >
            <RadioGroup
              style={{ marginBottom: 0 }}
              value={values.failover_count}
            >
              {nodeOptions.map((nodeOption) => (
                <FormControlLabel
                  key={nodeOption.value}
                  value={nodeOption.value}
                  label={nodeOption.label}
                  control={<Radio />}
                  data-qa-radio={nodeOption.label}
                  className={classes.formControlLabel}
                />
              ))}
            </RadioGroup>
            <FormHelperText>{errors.failover_count}</FormHelperText>
          </FormControl>
        </Grid>
        <Divider spacingTop={26} spacingBottom={12} />
        <Grid item style={{ maxWidth: 450 }}>
          <Typography variant="h2">Add Access Controls</Typography>
          <Typography>
            Explanatory text about adding inbound sources...
          </Typography>
          <Grid style={{ marginTop: 24 }}>
            <MultipleIPInput
              title="Inbound Sources"
              placeholder="Add IP Address or range"
              ips={values.allow_list}
              onChange={(address) => setFieldValue('allow_list', address)}
            />
          </Grid>
        </Grid>
      </Paper>
      <Grid className={classes.btnCtn}>
        <Button
          type="submit"
          buttonType="primary"
          disabled={disableCreateButton}
          loading={isSubmitting}
        >
          Create Database Cluster
        </Button>
      </Grid>
    </form>
  );
};

export default DatabaseCreate;
